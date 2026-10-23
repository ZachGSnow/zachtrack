import { addDays, DAY_MS, formatShortDate, startOfDay } from './time';
import { rangeStartFor, type ChartRange } from './stats';
import type { FieldAggregation } from '../db';

export interface TimestampedValues {
  timestamp: number;
  values?: Record<string, number | boolean>;
}

/** Minimal shape needed to know how to combine same-day entries for a field. */
export interface AggregatableField {
  id: string;
  aggregation?: FieldAggregation;
}

function combineDayValues(values: number[], mode: FieldAggregation): number {
  if (mode === 'sum') return values.reduce((a, b) => a + b, 0);
  if (mode === 'average') return values.reduce((a, b) => a + b, 0) / values.length;
  // 'last': values are pushed in chronological order by callers below.
  return values[values.length - 1];
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Formats a duration compactly and adaptively (minutes -> hours -> days -> months -> years). */
export function formatTimeSinceAdaptive(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${Math.max(0, totalMinutes)}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 60) return `${totalDays}d`;
  const totalMonths = Math.floor(totalDays / 30.44);
  if (totalMonths < 24) {
    const remDays = Math.round(totalDays - totalMonths * 30.44);
    return remDays > 0 ? `${totalMonths}mo ${remDays}d` : `${totalMonths}mo`;
  }
  const years = Math.floor(totalDays / 365.25);
  const remMonths = Math.round((totalDays - years * 365.25) / 30.44);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

export interface OccurrenceStats {
  total: number;
  avgIntervalHours: number | null;
  longestGapHours: number | null;
  shortestGapHours: number | null;
  currentStreakDays: number;
}

export function computeOccurrenceStats(entries: { timestamp: number }[]): OccurrenceStats {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const total = sorted.length;

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].timestamp - sorted[i - 1].timestamp) / 3600000);
  }
  const avgIntervalHours = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const longestGapHours = intervals.length ? Math.max(...intervals) : null;
  const shortestGapHours = intervals.length ? Math.min(...intervals) : null;

  const dayKeys = new Set(sorted.map((e) => startOfDay(e.timestamp)));
  const today = startOfDay(Date.now());
  let currentStreakDays = 0;
  if (dayKeys.has(today) || dayKeys.has(addDays(today, -1))) {
    let cursor = dayKeys.has(today) ? today : addDays(today, -1);
    while (dayKeys.has(cursor)) {
      currentStreakDays += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return { total, avgIntervalHours, longestGapHours, shortestGapHours, currentStreakDays };
}

export type BucketUnit = 'day' | 'week' | 'month';

function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function bucketStart(ms: number, bucket: BucketUnit): number {
  if (bucket === 'day') return startOfDay(ms);
  if (bucket === 'week') return startOfWeek(ms);
  return startOfMonth(ms);
}

function formatBucketLabel(ms: number, bucket: BucketUnit): string {
  if (bucket === 'month') return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  return formatShortDate(ms);
}

/** Occurrence counts bucketed by day/week/month over the selected range. */
export function computeOccurrenceBuckets(
  entries: { timestamp: number }[],
  bucket: BucketUnit,
  range: ChartRange,
): { categories: string[]; counts: number[] } {
  const rangeStart = bucketStart(rangeStartFor(range, entries.map((e) => e.timestamp)), bucket);
  const today = Date.now();

  const countByBucket = new Map<number, number>();
  for (const e of entries) {
    const b = bucketStart(e.timestamp, bucket);
    countByBucket.set(b, (countByBucket.get(b) ?? 0) + 1);
  }

  const categories: string[] = [];
  const counts: number[] = [];
  let cursor = rangeStart;
  const stepDays = bucket === 'day' ? 1 : bucket === 'week' ? 7 : null;

  if (stepDays) {
    while (cursor <= today) {
      categories.push(formatBucketLabel(cursor, bucket));
      counts.push(countByBucket.get(cursor) ?? 0);
      cursor = addDays(cursor, stepDays);
    }
  } else {
    // Month buckets have variable length; step via Date month arithmetic.
    const cursorDate = new Date(cursor);
    while (cursorDate.getTime() <= today) {
      const key = cursorDate.getTime();
      categories.push(formatBucketLabel(key, bucket));
      counts.push(countByBucket.get(key) ?? 0);
      cursorDate.setMonth(cursorDate.getMonth() + 1);
    }
  }

  return { categories, counts };
}

/** Hours between each occurrence and the one before it (first entry has no interval). */
export function computeIntervalTrend(entries: { timestamp: number }[]): { categories: string[]; intervalHours: number[] } {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const categories: string[] = [];
  const intervalHours: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    categories.push(formatShortDate(sorted[i].timestamp));
    intervalHours.push(Number(((sorted[i].timestamp - sorted[i - 1].timestamp) / 3600000).toFixed(1)));
  }
  return { categories, intervalHours };
}

/**
 * Per-day value for a single field, combining same-day entries per the
 * field's `aggregation` mode (sum/average/last; undefined behaves as
 * 'last'). Used by both TrackableFieldsChart and Charting so there's one
 * implementation of "how do multiple entries on the same day combine".
 */
export function computeFieldValuesByDay(entries: TimestampedValues[], field: AggregatableField): Map<number, number> {
  const mode: FieldAggregation = field.aggregation ?? 'last';
  const sorted = [...entries]
    .filter((e) => e.values?.[field.id] != null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const rawByDay = new Map<number, number[]>();
  for (const e of sorted) {
    const raw = e.values![field.id];
    const num = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
    const day = startOfDay(e.timestamp);
    const list = rawByDay.get(day);
    if (list) list.push(num);
    else rawByDay.set(day, [num]);
  }

  const byDay = new Map<number, number>();
  for (const [day, values] of rawByDay) {
    byDay.set(day, round(combineDayValues(values, mode)));
  }
  return byDay;
}

/** The days (local start-of-day) a field's series covers over the selected range, oldest first. */
export function fieldSeriesDays(entries: TimestampedValues[], field: AggregatableField, range: ChartRange): number[] {
  const withValue = entries.filter((e) => e.values?.[field.id] != null);
  const today = startOfDay(Date.now());
  const rangeStart = rangeStartFor(range, withValue.map((e) => e.timestamp));
  const numDays = Math.round((today - rangeStart) / DAY_MS) + 1;
  const days: number[] = [];
  for (let i = 0; i < numDays; i++) days.push(addDays(rangeStart, i));
  return days;
}

/** Daily value for a single field over the selected range (see `computeFieldValuesByDay`). */
export function computeFieldSeries(
  entries: TimestampedValues[],
  field: AggregatableField,
  range: ChartRange,
): { categories: string[]; values: (number | null)[] } {
  const byDay = computeFieldValuesByDay(entries, field);
  const days = fieldSeriesDays(entries, field, range);
  return { categories: days.map(formatShortDate), values: days.map((day) => byDay.get(day) ?? null) };
}

/** Today's combined value for a field (per its aggregation mode), or null if nothing logged today. */
export function computeFieldTodayTotal(entries: TimestampedValues[], field: AggregatableField): number | null {
  const today = startOfDay(Date.now());
  return computeFieldValuesByDay(entries, field).get(today) ?? null;
}
