import type { FastRecord } from '../db';
import { ZONES } from '../data/zones';
import { addDays, startOfDay } from './time';
import { goalDays } from './fastingJourney';

export interface FastStats {
  totalFasts: number;
  averageHours: number;
  longestHours: number;
  /** Days in a row with a fast that met its goal (utils/fastingJourney.ts goalMet). */
  currentStreak: number;
  longestStreak: number;
  /** Days in the last 30 (today included) on which any fast started. */
  daysFasted30: number;
  /** Completed fasts that had a target, and how many of them reached it. */
  withTarget: number;
  hitTarget: number;
}

/**
 * Streaks count consecutive calendar days on which a fast started and met its
 * goal (since v1.11.0; before, any fast counted, even one ended after minutes).
 * A running fast counts once it has passed its goal; until then today doesn't
 * break the streak. Totals and averages count completed fasts only.
 */
export function computeFastStats(fasts: FastRecord[]): FastStats {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);
  const totalFasts = completed.length;

  const hoursList = completed.map((f) => (f.endTime - f.startTime) / 3600000);
  const averageHours = hoursList.length ? hoursList.reduce((a, b) => a + b, 0) / hoursList.length : 0;
  const longestHours = hoursList.length ? Math.max(...hoursList) : 0;

  const now = Date.now();
  const dayKeys = goalDays(fasts, now);
  const sortedDays = Array.from(dayKeys).sort((a, b) => a - b);

  let longestStreak = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const day of sortedDays) {
    run = prevDay !== null && day === addDays(prevDay, 1) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prevDay = day;
  }

  const today = startOfDay(now);
  // Today, and the day a still-running fast started (last night's, at 6 a.m.),
  // may not have met the goal yet: skip them without breaking the streak.
  const pending = new Set(fasts.filter((f) => f.endTime == null && f.startTime <= now && !dayKeys.has(startOfDay(f.startTime))).map((f) => startOfDay(f.startTime)));
  let cursor = today;
  while (!dayKeys.has(cursor) && (cursor === today || pending.has(cursor))) cursor = addDays(cursor, -1);
  let currentStreak = 0;
  while (dayKeys.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  const targeted = completed.filter((f) => f.targetHours != null && f.targetHours > 0);
  const hitTarget = targeted.filter((f) => (f.endTime - f.startTime) / 3600000 >= f.targetHours!).length;

  const since = addDays(today, -29);
  const daysFasted30 = new Set(fasts.filter((f) => f.startTime >= since && f.startTime <= now).map((f) => startOfDay(f.startTime))).size;

  return { totalFasts, averageHours, longestHours, currentStreak, longestStreak, daysFasted30, withTarget: targeted.length, hitTarget };
}

export type ChartRange = '7' | '30' | '90' | 'all';

/** Shared by any per-day aggregation (fasting or generic trackables). */
export function rangeStartFor(range: ChartRange, candidateTimes: number[]): number {
  const today = startOfDay(Date.now());
  if (range === 'all') {
    return candidateTimes.length ? startOfDay(Math.min(...candidateTimes)) : today;
  }
  return addDays(today, -(Number(range) - 1));
}

export function filterSinceRange<T>(items: T[], range: ChartRange, getTime: (item: T) => number): T[] {
  if (range === 'all') return items;
  const today = startOfDay(Date.now());
  const start = addDays(today, -(Number(range) - 1));
  return items.filter((item) => getTime(item) >= start);
}

export function toIsoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface DurationHistogram {
  labels: string[];
  counts: number[];
}

const DURATION_BUCKETS = [
  { max: 12, label: '<12h' },
  { max: 14, label: '12-14h' },
  { max: 16, label: '14-16h' },
  { max: 18, label: '16-18h' },
  { max: 20, label: '18-20h' },
  { max: 24, label: '20-24h' },
  { max: 36, label: '24-36h' },
  { max: 48, label: '36-48h' },
  { max: Infinity, label: '48h+' },
];

/** Distribution of completed-fast durations across fixed buckets, all-time. */
export function computeDurationHistogram(fasts: FastRecord[]): DurationHistogram {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);
  const counts = new Array(DURATION_BUCKETS.length).fill(0);
  for (const f of completed) {
    const hrs = (f.endTime - f.startTime) / 3600000;
    const idx = DURATION_BUCKETS.findIndex((b) => hrs < b.max);
    counts[idx === -1 ? DURATION_BUCKETS.length - 1 : idx] += 1;
  }
  return { labels: DURATION_BUCKETS.map((b) => b.label), counts };
}

export interface DayOfWeekPattern {
  labels: string[];
  hours: number[];
}

/** Average fasting hours per weekday (Mon-Sun), all-time. */
export function computeDayOfWeekPattern(fasts: FastRecord[]): DayOfWeekPattern {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const f of completed) {
    const weekday = new Date(f.startTime).getDay(); // 0 = Sunday
    const hrs = (f.endTime - f.startTime) / 3600000;
    sums[weekday] += hrs;
    counts[weekday] += 1;
  }
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = order.map((i) => (counts[i] ? Number((sums[i] / counts[i]).toFixed(2)) : 0));
  return { labels, hours };
}

export interface ZoneBreakdownEntry {
  zoneId: string;
  title: string;
  color: string;
  hours: number;
}

/** Cumulative hours spent in each biological zone across completed fasts in the selected range. */
export function computeZoneBreakdown(fasts: FastRecord[], range: ChartRange): ZoneBreakdownEntry[] {
  const completed = filterSinceRange(
    fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null),
    range,
    (f) => f.startTime,
  );

  const totals = new Map<string, number>(ZONES.map((z) => [z.id, 0]));
  for (const f of completed) {
    const durationHours = (f.endTime - f.startTime) / 3600000;
    for (const zone of ZONES) {
      const zoneEnd = zone.hourEnd === Infinity ? durationHours : zone.hourEnd;
      const overlap = Math.max(0, Math.min(durationHours, zoneEnd) - zone.hourStart);
      if (overlap > 0) {
        totals.set(zone.id, (totals.get(zone.id) ?? 0) + overlap);
      }
    }
  }

  return ZONES.map((z) => ({
    zoneId: z.id,
    title: z.title,
    color: z.color,
    hours: Number((totals.get(z.id) ?? 0).toFixed(1)),
  }));
}
