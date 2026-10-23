import type { FastRecord } from '../db';
import type { GridDay } from './habitGrid';
import { bucketStart } from './trackableStats';
import { formatCountdown } from './fastingSchedule';
import { addDays, formatClockTime, formatHoursShort, HOUR_MS, startOfDay } from './time';

// Journey and the idle Fasting tab: whether a fast met its goal, the goal
// streak's days, this week against last, the fasting habit grid, the eating
// window after a fast, and how weight moves after goal fasts. Pure, so unit
// tested in tests/fastingJourney.test.ts.

/** A count-up fast has no goal; it counts as one once it reaches this many hours (the shortest preset). */
export const COUNT_UP_GOAL_HOURS = 12;

type Fast = Pick<FastRecord, 'startTime' | 'endTime' | 'targetHours'>;

/** The hours a fast has to reach to count: its target, or COUNT_UP_GOAL_HOURS without one. */
export function goalHours(fast: Pick<FastRecord, 'targetHours'>): number {
  return fast.targetHours && fast.targetHours > 0 ? fast.targetHours : COUNT_UP_GOAL_HOURS;
}

/** Hours fasted: to the end, or to `now` while running. */
export function fastHours(fast: Fast, now: number): number {
  return Math.max(0, ((fast.endTime ?? now) - fast.startTime) / HOUR_MS);
}

/** Met its goal: finished at or past it, or still running and already past it. */
export function goalMet(fast: Fast, now: number): boolean {
  if (fast.endTime == null && fast.startTime > now) return false;
  return fastHours(fast, now) >= goalHours(fast);
}

/** Local start-of-day of each day a fast that met its goal started. */
export function goalDays(fasts: readonly Fast[], now: number): Set<number> {
  return new Set(fasts.filter((f) => goalMet(f, now)).map((f) => startOfDay(f.startTime)));
}

export interface WeekSummary {
  /** Fasts that met their goal, by start day in the week. */
  goalFasts: number;
  /** Hours fasted by fasts started in the week (a running one to now). */
  hours: number;
  /** Average start time ("8:10 PM"), or null with no fasts. */
  averageStart: string | null;
}

/**
 * The average clock time of these starts. Times are measured from noon, so
 * fasts that start around midnight (11 PM and 1 AM) average to midnight,
 * not to noon.
 */
export function averageStartTime(starts: readonly number[]): string | null {
  if (starts.length === 0) return null;
  const minutesFromNoon = starts.map((s) => {
    const d = new Date(s);
    return (d.getHours() * 60 + d.getMinutes() - 12 * 60 + 24 * 60) % (24 * 60);
  });
  const avg = Math.round(minutesFromNoon.reduce((a, b) => a + b, 0) / starts.length);
  const at = new Date(2000, 0, 1, 12, 0);
  at.setMinutes(at.getMinutes() + avg);
  return formatClockTime(at.getTime());
}

function summarizeWeek(fasts: readonly Fast[], weekStart: number, now: number): WeekSummary {
  const end = addDays(weekStart, 7);
  const inWeek = fasts.filter((f) => f.startTime >= weekStart && f.startTime < end && f.startTime <= now);
  return {
    goalFasts: inWeek.filter((f) => goalMet(f, now)).length,
    hours: inWeek.reduce((sum, f) => sum + fastHours(f, now), 0),
    averageStart: averageStartTime(inWeek.map((f) => f.startTime)),
  };
}

/** This week (Monday to today) and last week, for Journey's comparison card. */
export function weekComparison(fasts: readonly Fast[], now: number): { thisWeek: WeekSummary; lastWeek: WeekSummary } {
  const monday = bucketStart(now, 'week');
  return { thisWeek: summarizeWeek(fasts, monday, now), lastWeek: summarizeWeek(fasts, addDays(monday, -7), now) };
}

/**
 * The fasting habit grid: `weeks` whole weeks (Monday to Sunday) ending with
 * this one, as columns, in HabitGrid.svelte's shape. A day's level is how far
 * its best fast got toward its goal; a met goal is full.
 */
export function fastGridWeeks(fasts: readonly Fast[], weeks: number, now: number): GridDay[][] {
  const today = startOfDay(now);
  const best = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const f of fasts) {
    if (f.startTime > now) continue;
    const d = startOfDay(f.startTime);
    best.set(d, Math.max(best.get(d) ?? 0, Math.min(1, fastHours(f, now) / goalHours(f))));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const firstMonday = addDays(bucketStart(now, 'week'), -7 * (weeks - 1));
  const cols: GridDay[][] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(firstMonday, i);
    if (i % 7 === 0) cols.push([]);
    const future = d > today;
    cols[cols.length - 1].push({
      day: d,
      level: future ? 0 : (best.get(d) ?? 0),
      count: counts.get(d) ?? 0,
      isToday: d === today,
      outside: future,
      future,
      missed: false,
      off: null,
    });
  }
  return cols;
}

export interface EatingWindow {
  /** "Eating window: 5h 40m left, until 8:00 PM", or "Eating window closed 1h ago". */
  text: string;
  open: boolean;
  /** "Last fast: 16h 12m, ended 2h 20m ago" */
  lastFast: string;
}

/**
 * After a fast with a goal under a day ends, its eating window is the rest of
 * the day: 8 hours after a 16:8 fast. Shown on the idle Fasting tab for a day
 * after the fast ended; null otherwise, or when a fast is running.
 */
export function eatingWindowStatus(fasts: readonly Fast[], now: number): EatingWindow | null {
  if (fasts.some((f) => f.endTime == null && f.startTime <= now)) return null;
  const last = fasts.filter((f) => f.endTime != null && f.endTime <= now).sort((a, b) => b.endTime! - a.endTime!)[0];
  if (!last || now - last.endTime! > 24 * HOUR_MS) return null;
  const lastFast = `Last fast: ${formatHoursShort(fastHours(last, now))}, ended ${formatCountdown(now - last.endTime!)} ago`;
  const target = last.targetHours;
  if (!target || target >= 24) return { text: '', open: false, lastFast };
  const closes = last.endTime! + (24 - target) * HOUR_MS;
  return now < closes
    ? { text: `Eating window: ${formatCountdown(closes - now)} left, until ${formatClockTime(closes)}`, open: true, lastFast }
    : { text: `Eating window closed ${formatCountdown(now - closes)} ago`, open: false, lastFast };
}

/** At least this many days on each side before the weight comparison says anything. */
export const MIN_WEIGHT_DAYS = 5;

/**
 * How weight changes from a day to the next, after days that started a goal
 * fast against other days, when both sides have MIN_WEIGHT_DAYS and the
 * difference is large against the day-to-day spread (Cohen's d of 0.6, as in
 * utils/insights.ts). A pattern, not a cause. `weightByDay` maps local
 * start-of-day to that day's weight.
 */
export function fastingWeightInsight(
  fasts: readonly Fast[],
  weightByDay: ReadonlyMap<number, number>,
  unit: string,
  now: number,
): string | null {
  const goal = goalDays(fasts, now);
  const after: number[] = [];
  const other: number[] = [];
  for (const [day, w] of weightByDay) {
    const next = weightByDay.get(addDays(day, 1));
    if (next == null) continue;
    (goal.has(day) ? after : other).push(next - w);
  }
  if (after.length < MIN_WEIGHT_DAYS || other.length < MIN_WEIGHT_DAYS) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = (xs: number[], m: number) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
  const a = mean(after);
  const b = mean(other);
  const pooled = Math.sqrt(((after.length - 1) * variance(after, a) + (other.length - 1) * variance(other, b)) / (after.length + other.length - 2));
  const size = pooled > 0 ? Math.abs(a - b) / pooled : a === b ? 0 : Infinity;
  if (size < 0.6) return null;
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit ? ` ${unit}` : ''}`;
  return `Weight changes ${fmt(a)} the day after a goal fast (${after.length} days), ${fmt(b)} after other days (${other.length})`;
}
