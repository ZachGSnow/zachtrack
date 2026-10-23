import type { FieldDefinition, TrackableDefinition, TrackableDisplayMode } from '../db';
import { addDays, DAY_MS, formatDateTime, formatShortDate, startOfDay } from './time';
import { computeFieldValuesByDay, formatTimeSinceAdaptive, type TimestampedValues } from './trackableStats';

/**
 * What a trackable is, which decides what its card and detail page lead with.
 * Picked automatically from its first field (like Apple Health's cumulative vs
 * discrete types), and overridable per trackable:
 * - event:       time since it last happened (no fields, or timing is the point)
 * - measurement: the latest value and how it changed (Weight, BP)
 * - daily:       today's total (Calories, Water: fields that sum same-day entries)
 * - checkin:     logged today or not, with a streak (ratings, yes/no)
 * - ages:        dates: birthdays, anniversaries, holidays, countdowns (utils/dates.ts; its own view)
 */
export type TrackableKind = 'event' | 'measurement' | 'daily' | 'checkin' | 'ages';

export const KIND_LABELS: Record<TrackableKind, string> = {
  event: 'Time since',
  measurement: 'Latest value',
  daily: 'Daily total',
  checkin: 'Check-in',
  ages: 'Dates (birthdays, holidays...)',
};

export const KIND_DESCRIPTIONS: Record<TrackableKind, string> = {
  event: 'Leads with how long since it last happened and the usual gap.',
  measurement: 'Leads with the latest reading of the first field and how it changed.',
  daily: "Leads with today's total of the first field and your daily average.",
  checkin: 'Leads with whether you logged today and your streak.',
  ages: 'Named dates with countdowns: birthdays with ages, anniversaries, holidays, or countdowns and renewals.',
};

const EXPLICIT_KINDS: readonly TrackableDisplayMode[] = ['event', 'measurement', 'daily', 'checkin', 'ages'];

/** The kind its fields suggest, and why, in words the edit sheet can show. */
export function autoKind(fields: readonly FieldDefinition[]): { kind: TrackableKind; reason: string } {
  const first = fields[0];
  if (!first) return { kind: 'event', reason: 'it has no fields, so when it happens is what counts' };
  if (first.kind === 'number') {
    return first.aggregation === 'sum'
      ? { kind: 'daily', reason: `${first.name} adds up same-day entries` }
      : { kind: 'measurement', reason: `${first.name} is a reading that keeps its latest value` };
  }
  return { kind: 'checkin', reason: `${first.name} is a ${first.kind === 'rating' ? 'rating' : 'yes/no'} you log each day` };
}

/** The kind a trackable is shown as: its override, or the automatic one. `occurrences` (and unset) means automatic. */
export function resolveKind(
  trackable: Pick<TrackableDefinition, 'displayMode'>,
  attachedFields: readonly FieldDefinition[],
): { kind: TrackableKind; auto: boolean; reason: string } {
  const mode = trackable.displayMode;
  if (mode && EXPLICIT_KINDS.includes(mode)) return { kind: mode as TrackableKind, auto: false, reason: 'chosen in Edit' };
  return { ...autoKind(attachedFields), auto: true };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface KindSummary {
  /** One line for the trackables list. */
  card: string;
  /** Detail page header: a small label, the big value, and supporting lines. */
  label: string;
  value: string;
  sub: string[];
}

export interface KindStat {
  label: string;
  value: string;
}

const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatNumber(v: number): string {
  return nf1.format(Math.abs(v) >= 1000 ? Math.round(v) : v);
}

function withUnit(field: FieldDefinition, v: number): string {
  if (field.kind === 'rating') return `${formatNumber(v)} / ${field.ratingMax ?? 5}`;
  if (field.kind === 'boolean') return v >= 0.5 ? 'Yes' : 'No';
  return field.unit ? `${formatNumber(v)} ${field.unit}` : formatNumber(v);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Gaps between consecutive entries, in ms, oldest first. */
function gaps(sortedTimes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < sortedTimes.length; i++) out.push(sortedTimes[i] - sortedTimes[i - 1]);
  return out;
}

/** Current and longest run of consecutive days with an entry. The current run may end yesterday. */
export function dayStreaks(times: number[], now: number): { current: number; longest: number } {
  const days = [...new Set(times.map(startOfDay))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev != null && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const daySet = new Set(days);
  const today = startOfDay(now);
  let cursor = daySet.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (daySet.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

/** Daily values of a field on the `n` days before today (today excluded, since it's still filling up). */
function previousDays(byDay: Map<number, number>, now: number, n: number): number[] {
  const today = startOfDay(now);
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const v = byDay.get(addDays(today, -i));
    if (v != null) out.push(v);
  }
  return out;
}

function pickField(kind: TrackableKind, fields: readonly FieldDefinition[]): FieldDefinition | undefined {
  if (kind === 'daily') return fields.find((f) => f.kind === 'number' && f.aggregation === 'sum') ?? fields.find((f) => f.kind === 'number');
  if (kind === 'measurement') return fields.find((f) => f.kind === 'number') ?? fields[0];
  if (kind === 'checkin') return fields.find((f) => f.kind === 'rating') ?? fields[0];
  return undefined;
}

/** What the card and the detail header show for a trackable of this kind. */
export function summarize(
  kind: TrackableKind,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  now: number = Date.now(),
): KindSummary {
  const times = entries.map((e) => e.timestamp).sort((a, b) => a - b);
  const last = times.at(-1);
  if (last == null) return { card: 'No entries yet', label: KIND_LABELS[kind], value: '\u2014', sub: [] };
  const since = formatTimeSinceAdaptive(now - last);
  const field = pickField(kind, fields);

  if (kind === 'measurement' && field) {
    const readings = entries.filter((e) => e.values?.[field.id] != null).sort((a, b) => a.timestamp - b.timestamp);
    const latest = readings.at(-1);
    if (latest) {
      const v = Number(latest.values![field.id]);
      const weekBefore = [...readings].reverse().find((r) => r.timestamp <= latest.timestamp - 6 * DAY_MS);
      const sub: string[] = [];
      if (weekBefore && field.kind === 'number') {
        const d = v - Number(weekBefore.values![field.id]);
        const arrow = Math.abs(d) < 0.05 ? 'no change' : `${d > 0 ? '\u25b2' : '\u25bc'}${formatNumber(Math.abs(d))}`;
        sub.push(`${arrow} since ${formatShortDate(weekBefore.timestamp)}`);
      }
      sub.push(formatDateTime(latest.timestamp));
      const value = withUnit(field, v);
      return { card: `${value} \u00b7 ${since} ago`, label: `Latest ${field.name}`, value, sub };
    }
  }

  if (kind === 'daily' && field) {
    const byDay = computeFieldValuesByDay(entries as TimestampedValues[], field);
    const today = byDay.get(startOfDay(now));
    const avg = mean(previousDays(byDay, now, 7));
    const sub = [...(avg != null ? [`7-day avg ${withUnit(field, avg)}`] : []), `last logged ${since} ago`];
    const value = withUnit(field, today ?? 0);
    return {
      card: today != null ? `${value} today` : `Nothing today \u00b7 last ${since} ago`,
      label: `${field.name} today`,
      value,
      sub,
    };
  }

  if (kind === 'checkin') {
    const loggedToday = startOfDay(last) === startOfDay(now);
    const { current } = dayStreaks(times, now);
    const streak = current > 0 ? `${current}-day streak` : 'no current streak';
    const sub = [streak];
    if (field && field.kind !== 'boolean') {
      const byDay = computeFieldValuesByDay(entries as TimestampedValues[], field);
      const avg = mean(previousDays(byDay, now, 7));
      const todayValue = byDay.get(startOfDay(now));
      sub.push(
        [todayValue != null ? `${field.name} ${withUnit(field, todayValue)}` : null, avg != null ? `7-day avg ${formatNumber(avg)}` : null]
          .filter(Boolean)
          .join(' \u00b7 ') || `${field.name}: nothing yet`,
      );
    }
    return {
      card: loggedToday ? `\u2713 today \u00b7 ${streak}` : `Not yet today \u00b7 last ${since} ago`,
      label: 'Today',
      value: loggedToday ? 'Logged' : 'Not yet',
      sub,
    };
  }

  // event (and any kind whose field is missing): time since.
  const typical = median(gaps(times));
  const usually = typical != null ? `usually every ${formatTimeSinceAdaptive(typical)}` : null;
  return {
    card: usually ? `${since} ago \u00b7 ${usually}` : `${since} ago`,
    label: 'Time since last',
    value: since,
    sub: [...(usually ? [usually] : []), formatDateTime(last)],
  };
}

/** The four stat cards under the header, chosen for the kind. */
export function kindStats(
  kind: TrackableKind,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  now: number = Date.now(),
): KindStat[] {
  const times = entries.map((e) => e.timestamp).sort((a, b) => a - b);
  const dash = '\u2014';
  const field = pickField(kind, fields);
  const since30 = startOfDay(addDays(startOfDay(now), -29));
  const daysLogged30 = new Set(times.filter((t) => t >= since30).map(startOfDay)).size;

  if (kind === 'measurement' && field && field.kind === 'number') {
    const readings = entries.filter((e) => e.values?.[field.id] != null).sort((a, b) => a.timestamp - b.timestamp);
    const recent = readings.filter((r) => r.timestamp >= startOfDay(addDays(startOfDay(now), -89))).map((r) => Number(r.values![field.id]));
    const latest = readings.at(-1);
    const monthAgo = latest ? [...readings].reverse().find((r) => r.timestamp <= latest.timestamp - 29 * DAY_MS) : undefined;
    const change = latest && monthAgo ? Number(latest.values![field.id]) - Number(monthAgo.values![field.id]) : null;
    return [
      { label: 'Readings', value: String(readings.length) },
      { label: '30-day change', value: change == null ? dash : `${change > 0 ? '+' : change < 0 ? '\u2212' : ''}${formatNumber(Math.abs(change))}` },
      { label: '90-day low', value: recent.length ? withUnit(field, Math.min(...recent)) : dash },
      { label: '90-day high', value: recent.length ? withUnit(field, Math.max(...recent)) : dash },
    ];
  }

  if (kind === 'daily' && field) {
    const byDay = computeFieldValuesByDay(entries as TimestampedValues[], field);
    const avg7 = mean(previousDays(byDay, now, 7));
    const avg30 = mean(previousDays(byDay, now, 30));
    return [
      { label: '7-day avg', value: avg7 == null ? dash : withUnit(field, avg7) },
      { label: '30-day avg', value: avg30 == null ? dash : withUnit(field, avg30) },
      { label: 'Days logged (30d)', value: `${daysLogged30} / 30` },
      { label: 'Current streak', value: `${dayStreaks(times, now).current} days` },
    ];
  }

  if (kind === 'checkin') {
    const { current, longest } = dayStreaks(times, now);
    const byDay = field && field.kind !== 'boolean' ? computeFieldValuesByDay(entries as TimestampedValues[], field) : null;
    const avg7 = byDay ? mean(previousDays(byDay, now, 7)) : null;
    return [
      { label: 'Current streak', value: `${current} days` },
      { label: 'Longest streak', value: `${longest} days` },
      { label: 'Days logged (30d)', value: `${daysLogged30} / 30` },
      byDay && field
        ? { label: `${field.name} 7-day avg`, value: avg7 == null ? dash : formatNumber(avg7) }
        : { label: 'Total', value: String(times.length) },
    ];
  }

  const g = gaps(times);
  const typical = median(g);
  return [
    { label: 'Total', value: String(times.length) },
    { label: 'Usual gap', value: typical == null ? dash : formatTimeSinceAdaptive(typical) },
    { label: 'Longest gap', value: g.length ? formatTimeSinceAdaptive(Math.max(...g)) : dash },
    { label: 'Last 30 days', value: String(times.filter((t) => t >= since30).length) },
  ];
}
