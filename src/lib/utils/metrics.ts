import type { FastRecord, FieldDefinition, TrackableDefinition } from '../db';
import { addDays, formatShortDate, startOfDay } from './time';
import { toIsoDate } from './stats';
import { bucketStart, computeFieldValuesByDay, type BucketUnit, type TimestampedValues } from './trackableStats';
import { computeBMI } from './health';

/**
 * Shared "metric catalog" + table math behind every data view (the Data tab,
 * Journey's fasting table, and each trackable's Trends table). One place
 * decides what a metric's per-day value is and how days roll up into
 * weeks/months, so the table and chart views can never disagree.
 */

export type Granularity = BucketUnit;

/**
 * How a metric's daily values roll up into a week/month (and into the
 * 7-day rolling average):
 * - mean:    average of the days that have a value; unlogged days are skipped,
 *            not treated as 0 (Weight, ratings, and `sum` fields' daily totals)
 * - count:   total of daily counts; a day with nothing logged really is 0
 * - percent: share of logged days that were "yes", on a 0-100 scale (booleans)
 * - last:    most recent value on or before the period's end (cumulative totals)
 */
export type PeriodRollup = 'mean' | 'count' | 'percent' | 'last';

export interface MetricDef {
  id: string;
  /** Full, unambiguous name (chips, chart legend, clipboard headers). */
  label: string;
  /** Compact table column header. */
  column: string;
  group: string;
  color: string;
  unit?: string;
  rollup: PeriodRollup;
  /** Keyed by local start-of-day. Boolean fields are stored as 0/1. */
  valuesByDay: Map<number, number>;
  chartType: 'bar' | 'line';
  axisGroup: string;
  axisLabel: string;
  axisMin?: number;
  axisMax?: number;
  isWeightField?: boolean;
}

export const ROLLING_WINDOW_DAYS = 7;

export const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export const PERIOD_HEADERS: Record<Granularity, string> = { day: 'Day', week: 'Week of', month: 'Month' };

// ---------------------------------------------------------------------------
// Catalog builders
// ---------------------------------------------------------------------------

function averageByDay(pairs: { day: number; value: number }[]): Map<number, number> {
  const sums = new Map<number, { sum: number; count: number }>();
  for (const { day, value } of pairs) {
    const cur = sums.get(day) ?? { sum: 0, count: 0 };
    cur.sum += value;
    cur.count += 1;
    sums.set(day, cur);
  }
  const result = new Map<number, number>();
  for (const [day, { sum, count }] of sums) result.set(day, sum / count);
  return result;
}

/** Fasting metrics from completed fasts, each keyed to the day the fast started. */
export function buildFastingMetrics(fasts: FastRecord[]): MetricDef[] {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);

  const hoursByDay = new Map<number, number>();
  const countByDay = new Map<number, number>();
  const mood: { day: number; value: number }[] = [];
  const energy: { day: number; value: number }[] = [];
  const hunger: { day: number; value: number }[] = [];

  for (const f of completed) {
    const day = startOfDay(f.startTime);
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + (f.endTime - f.startTime) / 3600000);
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
    if (f.moodRating != null) mood.push({ day, value: f.moodRating });
    if (f.energyRating != null) energy.push({ day, value: f.energyRating });
    if (f.hungerRating != null) hunger.push({ day, value: f.hungerRating });
  }

  const cumulativeByDay = new Map<number, number>();
  let running = 0;
  for (const day of [...hoursByDay.keys()].sort((a, b) => a - b)) {
    running += hoursByDay.get(day)!;
    cumulativeByDay.set(day, running);
  }

  const rating = (id: string, label: string, color: string, pairs: { day: number; value: number }[]): MetricDef => ({
    id: `fasting:${id}`,
    label,
    column: label,
    group: 'Fasting',
    color,
    unit: '1\u20135',
    rollup: 'mean',
    valuesByDay: averageByDay(pairs),
    chartType: 'line',
    axisGroup: 'rating',
    axisLabel: 'Rating',
    axisMin: 1,
    axisMax: 5,
  });

  return [
    {
      id: 'fasting:hours',
      label: 'Fasting Hours',
      column: 'Fast length',
      group: 'Fasting',
      color: '#22ff88',
      unit: 'h',
      rollup: 'mean',
      valuesByDay: hoursByDay,
      chartType: 'bar',
      axisGroup: 'fastingHours',
      axisLabel: 'Hours',
    },
    {
      id: 'fasting:count',
      label: 'Fasts',
      column: 'Fasts',
      group: 'Fasting',
      color: '#4ade80',
      rollup: 'count',
      valuesByDay: countByDay,
      chartType: 'bar',
      axisGroup: 'occurrence',
      axisLabel: 'Occurrences',
    },
    {
      id: 'fasting:total',
      label: 'Total Hours',
      column: 'Total',
      group: 'Fasting',
      color: '#10b981',
      unit: 'h',
      rollup: 'last',
      valuesByDay: cumulativeByDay,
      chartType: 'line',
      axisGroup: 'fastingTotal',
      axisLabel: 'Total Hours',
    },
    rating('mood', 'Mood', '#eab308', mood),
    rating('energy', 'Energy', '#ec4899', energy),
    rating('hunger', 'Hunger', '#ef4444', hunger),
  ];
}

/** Short unit/scale caption for a field's column header (booleans have none). */
export function fieldUnitLabel(field: FieldDefinition): string | undefined {
  if (field.kind === 'number') return field.unit;
  if (field.kind === 'rating') return `${field.ratingMin ?? 1}\u2013${field.ratingMax ?? 5}`;
  return undefined;
}

/** An occurrence-count metric plus one metric per attached field, in the trackable's field order. */
export function buildTrackableMetrics(
  trackable: TrackableDefinition,
  entries: TimestampedValues[],
  allFields: FieldDefinition[],
  colorFor: (field: FieldDefinition) => string,
): MetricDef[] {
  const occByDay = new Map<number, number>();
  for (const e of entries) {
    const day = startOfDay(e.timestamp);
    occByDay.set(day, (occByDay.get(day) ?? 0) + 1);
  }

  const defs: MetricDef[] = [
    {
      id: `trackable:${trackable.id}:occurrence`,
      label: `${trackable.name} (occurrences)`,
      column: trackable.name,
      group: trackable.name,
      color: trackable.color,
      rollup: 'count',
      valuesByDay: occByDay,
      chartType: 'bar',
      axisGroup: 'occurrence',
      axisLabel: 'Occurrences',
    },
  ];

  for (const fieldId of trackable.fieldIds) {
    const field = allFields.find((f) => f.id === fieldId);
    if (!field) continue;
    defs.push({
      id: `trackable:${trackable.id}:field:${fieldId}`,
      label: `${field.name} (${trackable.name})`,
      column: field.name,
      group: trackable.name,
      color: colorFor(field),
      unit: fieldUnitLabel(field),
      rollup: field.kind === 'boolean' ? 'percent' : 'mean',
      valuesByDay: computeFieldValuesByDay(entries, field),
      chartType: 'line',
      axisGroup: field.kind === 'rating' ? 'rating' : field.kind === 'boolean' ? 'boolean' : `unit:${field.unit ?? 'number'}`,
      axisLabel: field.kind === 'rating' ? 'Rating' : field.kind === 'boolean' ? 'Yes/No' : (field.unit ?? 'Value'),
      axisMin: field.kind === 'rating' ? (field.ratingMin ?? 1) : field.kind === 'boolean' ? 0 : undefined,
      axisMax: field.kind === 'rating' ? (field.ratingMax ?? 5) : field.kind === 'boolean' ? 1 : undefined,
      isWeightField: field.kind === 'number' && field.name.toLowerCase() === 'weight',
    });
  }

  return defs;
}

/** BMI derived day-by-day from a Weight metric (US units). */
export function buildBmiMetric(weight: MetricDef, heightInches: number): MetricDef {
  const byDay = new Map<number, number>();
  for (const [day, lb] of weight.valuesByDay) byDay.set(day, computeBMI(lb, heightInches));
  return {
    id: `${weight.id}:bmi`,
    label: 'BMI',
    column: 'BMI',
    group: weight.group,
    color: '#f472b6',
    rollup: 'mean',
    valuesByDay: byDay,
    chartType: 'line',
    axisGroup: 'bmi',
    axisLabel: 'BMI',
  };
}

// ---------------------------------------------------------------------------
// Day / period math
// ---------------------------------------------------------------------------

const sortedDaysCache = new WeakMap<Map<number, number>, number[]>();

function sortedDays(map: Map<number, number>): number[] {
  let days = sortedDaysCache.get(map);
  if (!days) {
    days = [...map.keys()].sort((a, b) => a - b);
    sortedDaysCache.set(map, days);
  }
  return days;
}

function lastAtOrBefore(map: Map<number, number>, day: number): number | null {
  const days = sortedDays(map);
  let lo = 0;
  let hi = days.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? map.get(days[found])! : null;
}

/**
 * A metric's raw value for one day: carried forward for cumulative metrics,
 * 0 for count metrics with nothing logged, otherwise null when unlogged.
 * Boolean (percent) metrics return their raw 0/1 here.
 */
export function valueOnDay(m: MetricDef, day: number): number | null {
  if (m.rollup === 'last') return lastAtOrBefore(m.valuesByDay, day);
  const v = m.valuesByDay.get(day);
  if (v != null) return v;
  return m.rollup === 'count' ? 0 : null;
}

function nextPeriod(start: number, g: Granularity): number {
  if (g === 'day') return addDays(start, 1);
  if (g === 'week') return addDays(start, 7);
  const d = new Date(start);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

function prevPeriod(start: number, g: Granularity): number {
  if (g === 'day') return addDays(start, -1);
  if (g === 'week') return addDays(start, -7);
  const d = new Date(start);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
}

function periodLabel(start: number, g: Granularity): string {
  if (g === 'month') return new Date(start).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return formatShortDate(start);
}

/** Aggregates the days in [start, endExclusive), never looking past today. */
function periodValue(m: MetricDef, start: number, endExclusive: number, today: number): number | null {
  const lastDay = Math.min(addDays(endExclusive, -1), today);
  if (m.rollup === 'last') return lastAtOrBefore(m.valuesByDay, lastDay);

  let sum = 0;
  let n = 0;
  for (let d = start; d <= lastDay; d = addDays(d, 1)) {
    const v = m.valuesByDay.get(d);
    if (v == null) continue;
    sum += v;
    n += 1;
  }
  if (m.rollup === 'count') return sum;
  if (n === 0) return null;
  return m.rollup === 'percent' ? (sum / n) * 100 : sum / n;
}

/**
 * Trailing N-day average ending on `day`. Count metrics average per calendar
 * day (unlogged days are 0); mean/percent metrics average only logged days and
 * need at least 2 of them, since a "7-day average" of one reading is just
 * that reading. Cumulative metrics have no meaningful rolling average.
 */
function rollingAverage(m: MetricDef, day: number, windowDays = ROLLING_WINDOW_DAYS): number | null {
  if (m.rollup === 'last') return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < windowDays; i++) {
    const v = m.valuesByDay.get(addDays(day, -i));
    if (v == null) continue;
    sum += v;
    n += 1;
  }
  if (m.rollup === 'count') return sum / windowDays;
  if (n < 2) return null;
  return m.rollup === 'percent' ? (sum / n) * 100 : sum / n;
}

/** Least-squares slope of the daily values across [from, to], expressed per week. */
function slopePerWeek(m: MetricDef, from: number, to: number): number | null {
  const scale = m.rollup === 'percent' ? 100 : 1;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let x = 0;
  for (let d = from; d <= to; d = addDays(d, 1), x++) {
    const v = valueOnDay(m, d);
    if (v == null) continue;
    const y = v * scale;
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 2) return null;
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return ((n * sxy - sx * sy) / denom) * 7;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface MetricTableCell {
  value: number | null;
  /** Day view: 7-day rolling average. Week/month view: change vs the previous period. */
  secondary: number | null;
}

export interface MetricTableRow {
  start: number;
  label: string;
  sublabel?: string;
  /** The current, still-in-progress week/month. */
  partial: boolean;
  cells: MetricTableCell[];
}

export interface MetricTableSummary {
  avg: (number | null)[];
  change: (number | null)[];
  perWeek: (number | null)[];
}

export interface MetricTable {
  granularity: Granularity;
  /** Newest first. */
  rows: MetricTableRow[];
  summary: MetricTableSummary;
}

/**
 * Builds rows (one per day/week/month overlapping [rangeStart, today]) and a
 * range summary. Periods are always whole buckets, so a range start that
 * falls mid-week still shows that full week.
 */
export function computeMetricTable(metrics: MetricDef[], granularity: Granularity, rangeStart: number): MetricTable {
  const today = startOfDay(Date.now());
  const tomorrow = addDays(today, 1);
  const from = Math.min(startOfDay(rangeStart), today);

  const starts: number[] = [];
  for (let p = bucketStart(from, granularity); p <= today; p = nextPeriod(p, granularity)) starts.push(p);

  const values = metrics.map((m) => starts.map((s) => periodValue(m, s, nextPeriod(s, granularity), today)));
  const priorValues = metrics.map((m) =>
    starts.length ? periodValue(m, prevPeriod(starts[0], granularity), starts[0], today) : null,
  );

  const rows: MetricTableRow[] = starts.map((start, pi) => {
    const partial = granularity !== 'day' && nextPeriod(start, granularity) > tomorrow;
    return {
      start,
      label: periodLabel(start, granularity),
      sublabel:
        granularity === 'day' ? new Date(start).toLocaleDateString(undefined, { weekday: 'short' }) : partial ? 'so far' : undefined,
      partial,
      cells: metrics.map((m, mi) => {
        const value = values[mi][pi];
        if (granularity === 'day') return { value, secondary: rollingAverage(m, start) };
        const prev = pi > 0 ? values[mi][pi - 1] : priorValues[mi];
        return { value, secondary: value != null && prev != null ? value - prev : null };
      }),
    };
  });

  const summary: MetricTableSummary = { avg: [], change: [], perWeek: [] };
  metrics.forEach((m, mi) => {
    const present = values[mi].filter((v): v is number => v != null);
    summary.avg.push(m.rollup !== 'last' && present.length ? present.reduce((a, b) => a + b, 0) / present.length : null);
    summary.change.push(present.length >= 2 ? present[present.length - 1] - present[0] : null);
    summary.perWeek.push(slopePerWeek(m, from, today));
  });

  rows.reverse();
  return { granularity, rows, summary };
}

// ---------------------------------------------------------------------------
// Formatting + export
// ---------------------------------------------------------------------------

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function decimalsFor(m: MetricDef, v: number): number {
  return m.rollup === 'percent' || Math.abs(v) >= 1000 ? 0 : 1;
}

function formatMagnitude(m: MetricDef, v: number): string {
  const text = (decimalsFor(m, v) === 0 ? nf0 : nf1).format(v);
  return m.rollup === 'percent' ? `${text}%` : text;
}

/** `asYesNo` renders a boolean metric's single-day value as Yes/No instead of a percentage. */
export function formatMetricValue(m: MetricDef, v: number | null, asYesNo = false): string {
  if (v == null) return '\u2013';
  if (m.rollup === 'percent' && asYesNo) return v >= 50 ? 'Yes' : 'No';
  return formatMagnitude(m, v);
}

/** Neutral directional change, e.g. "^1.2" / "v0.4"; "-" when missing or rounds to zero. */
export function formatMetricDelta(m: MetricDef, d: number | null, suffix = ''): string {
  if (d == null) return '\u2013';
  const abs = Math.abs(d);
  if (Math.round(abs * 10 ** decimalsFor(m, abs)) === 0) return '\u2013';
  return `${d > 0 ? '\u25b2' : '\u25bc'}${formatMagnitude(m, abs)}${suffix}`;
}

function tsvNumber(v: number | null): string {
  return v == null ? '' : String(Math.round(v * 100) / 100);
}

/** Tab-separated copy of the visible table (pastes cleanly into a spreadsheet). */
export function metricTableToTsv(metrics: MetricDef[], table: MetricTable): string {
  const secondaryLabel = table.granularity === 'day' ? `${ROLLING_WINDOW_DAYS}d avg` : 'change';
  const header = [
    PERIOD_HEADERS[table.granularity],
    ...metrics.flatMap((m) => {
      const name = m.unit ? `${m.label} (${m.unit})` : m.label;
      return [name, `${name} ${secondaryLabel}`];
    }),
  ];
  const lines = [header.join('\t')];
  for (const row of table.rows) {
    lines.push([toIsoDate(row.start), ...row.cells.flatMap((c) => [tsvNumber(c.value), tsvNumber(c.secondary)])].join('\t'));
  }
  return lines.join('\n');
}
