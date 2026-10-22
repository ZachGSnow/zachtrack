import type { FastRecord } from '../db';
import { ZONES } from '../data/zones';
import { addDays, DAY_MS, startOfDay } from './time';

export interface FastStats {
  totalFasts: number;
  averageHours: number;
  longestHours: number;
  currentStreak: number;
  longestStreak: number;
}

/** A fast with no end time that started in the past (the one the timer shows). */
const isRunning = (f: FastRecord) => f.endTime == null && f.startTime <= Date.now();

/**
 * Streaks are counted as consecutive calendar days on which a fast started and
 * was completed or is still running. Totals and averages count completed fasts only.
 */
export function computeFastStats(fasts: FastRecord[]): FastStats {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);
  const totalFasts = completed.length;

  const hoursList = completed.map((f) => (f.endTime - f.startTime) / 3600000);
  const averageHours = hoursList.length ? hoursList.reduce((a, b) => a + b, 0) / hoursList.length : 0;
  const longestHours = hoursList.length ? Math.max(...hoursList) : 0;

  // A fast still in progress counts for the day it started. Without it, an
  // overnight fast made the current streak read 0 every morning until it ended.
  const dayKeys = new Set(fasts.filter((f) => f.endTime != null || isRunning(f)).map((f) => startOfDay(f.startTime)));
  const sortedDays = Array.from(dayKeys).sort((a, b) => a - b);

  let longestStreak = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const day of sortedDays) {
    run = prevDay !== null && day === addDays(prevDay, 1) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prevDay = day;
  }

  const today = startOfDay(Date.now());
  let currentStreak = 0;
  if (dayKeys.has(today) || dayKeys.has(addDays(today, -1))) {
    let cursor = dayKeys.has(today) ? today : addDays(today, -1);
    while (dayKeys.has(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return { totalFasts, averageHours, longestHours, currentStreak, longestStreak };
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

export interface HeatmapData {
  start: string;
  end: string;
  data: [string, number][];
}

export type HeatmapMetric = 'hours' | 'mood' | 'energy' | 'goal';

/**
 * Daily values as [isoDate, value] pairs, for an ECharts calendar heatmap.
 * - 'hours': total fasting hours that day (always present, 0 if no fast).
 * - 'mood' / 'energy': that day's fast rating (omitted if not rated/no fast).
 * - 'goal': % of target hours reached (omitted for days with no target, e.g. custom fasts).
 */
export function computeHeatmapData(fasts: FastRecord[], range: ChartRange, metric: HeatmapMetric = 'hours'): HeatmapData {
  const completed = fasts.filter((f): f is FastRecord & { endTime: number } => f.endTime != null);
  const today = startOfDay(Date.now());
  const rangeStart = rangeStartFor(range, completed.map((f) => f.startTime));
  const numDays = Math.round((today - rangeStart) / DAY_MS) + 1;

  const valueByDay = new Map<number, number>();
  for (const f of completed) {
    const day = startOfDay(f.startTime);
    const hrs = (f.endTime - f.startTime) / 3600000;
    if (metric === 'hours') {
      valueByDay.set(day, (valueByDay.get(day) ?? 0) + hrs);
    } else if (metric === 'mood' && f.moodRating != null) {
      valueByDay.set(day, f.moodRating);
    } else if (metric === 'energy' && f.energyRating != null) {
      valueByDay.set(day, f.energyRating);
    } else if (metric === 'goal' && f.targetHours) {
      valueByDay.set(day, Number(((hrs / f.targetHours) * 100).toFixed(0)));
    }
  }

  const data: [string, number][] = [];
  for (let i = 0; i < numDays; i++) {
    const day = addDays(rangeStart, i);
    const value = valueByDay.get(day);
    if (metric === 'hours') {
      data.push([toIsoDate(day), Number((value ?? 0).toFixed(2))]);
    } else if (value != null) {
      data.push([toIsoDate(day), value]);
    }
  }

  return { start: toIsoDate(rangeStart), end: toIsoDate(today), data };
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
