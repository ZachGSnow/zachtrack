import { addDays, DAY_MS, startOfDay } from './time';

// Reading a measurement through its noise. A morning weight swings a pound
// or two with water, so the headline is a 7-day average against the week
// before, the direction is a least-squares slope over the last 30 days, and
// a goal gets a date at that rate. All from a field's values by day
// (trackableStats.computeFieldValuesByDay). Pure; tests/measurement.test.ts.

/** The 7-day average, and the one for the 7 days before it. */
export const AVERAGE_DAYS = 7;
/** The window the trend is fitted over. */
export const TREND_DAYS = 30;
/** Fewer readings than this in a window and the trend says nothing. */
export const MIN_TREND_POINTS = 5;

/** Mean of the values on the `days` days ending today (today included), or null with none. */
export function rollingAverage(byDay: ReadonlyMap<number, number>, now: number, days: number = AVERAGE_DAYS, endOffsetDays = 0): number | null {
  const end = addDays(startOfDay(now), -endOffsetDays);
  const values: number[] = [];
  for (let i = 0; i < days; i++) {
    const v = byDay.get(addDays(end, -i));
    if (v != null) values.push(v);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export interface Averages {
  /** The last 7 days. */
  current: number;
  /** The 7 days before those, when there were readings. */
  previous: number | null;
  /** current minus previous. */
  change: number | null;
}

export function weeklyAverages(byDay: ReadonlyMap<number, number>, now: number): Averages | null {
  const current = rollingAverage(byDay, now);
  if (current == null) return null;
  const previous = rollingAverage(byDay, now, AVERAGE_DAYS, AVERAGE_DAYS);
  return { current, previous, change: previous == null ? null : current - previous };
}

/**
 * The slope of a least-squares line through the last TREND_DAYS days of
 * values, in units per week; null with fewer than MIN_TREND_POINTS readings
 * or when they all fall on one day.
 */
export function trendPerWeek(byDay: ReadonlyMap<number, number>, now: number, days: number = TREND_DAYS): number | null {
  const today = startOfDay(now);
  const since = addDays(today, -(days - 1));
  const points: Array<[number, number]> = [];
  // Whole days: a DST change makes one day 23 or 25 hours.
  for (const [day, v] of byDay) if (day >= since && day <= today) points.push([Math.round((day - since) / DAY_MS), v]);
  if (points.length < MIN_TREND_POINTS) return null;
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  return (sxy / sxx) * 7;
}

export type GoalProjection =
  /** Heading for the goal: reaches it about `at` (local midnight) at this rate. */
  | { kind: 'toward'; at: number; weeks: number }
  /** Moving the wrong way. */
  | { kind: 'away' }
  /** Within a quarter unit of the goal, or no rate to speak of. */
  | { kind: 'there' }
  | { kind: 'flat' };

/** Rates smaller than this per week count as flat. */
export const FLAT_PER_WEEK = 0.05;

/** Where the current average is going against a goal at `perWeek`. */
export function projectGoal(current: number, goal: number, perWeek: number | null, now: number): GoalProjection | null {
  const gap = goal - current;
  if (Math.abs(gap) < 0.25) return { kind: 'there' };
  if (perWeek == null) return null;
  if (Math.abs(perWeek) < FLAT_PER_WEEK) return { kind: 'flat' };
  if (Math.sign(perWeek) !== Math.sign(gap)) return { kind: 'away' };
  const weeks = gap / perWeek;
  // Further out than five years isn't a forecast.
  if (weeks > 260) return { kind: 'flat' };
  return { kind: 'toward', at: addDays(startOfDay(now), Math.round(weeks * 7)), weeks };
}

const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** "▼0.3 lb/wk over 30 days", "about level over 30 days". */
export function describeTrend(perWeek: number | null, unit: string | undefined): string | null {
  if (perWeek == null) return null;
  const u = unit ? ` ${unit}` : '';
  if (Math.abs(perWeek) < FLAT_PER_WEEK) return `About level over the last ${TREND_DAYS} days`;
  const n = Math.abs(perWeek) < 1 ? nf2.format(Math.abs(perWeek)) : nf1.format(Math.abs(perWeek));
  return `${perWeek > 0 ? '▲' : '▼'}${n}${u}/wk over the last ${TREND_DAYS} days`;
}

/** "At this rate, 176 lb around Mar 14", "Moving away from 176 lb", "At your goal of 176 lb". */
export function describeProjection(p: GoalProjection | null, goal: number, unit: string | undefined): string | null {
  if (!p) return null;
  const target = `${nf1.format(goal)}${unit ? ` ${unit}` : ''}`;
  switch (p.kind) {
    case 'there':
      return `At your goal of ${target}`;
    case 'away':
      return `Moving away from your goal of ${target}`;
    case 'flat':
      return `Holding steady; your goal is ${target}`;
    case 'toward': {
      const date = new Date(p.at);
      const sameYear = date.getFullYear() === new Date().getFullYear();
      const when = date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
      return p.weeks < 1 ? `At this rate, ${target} within the week` : `At this rate, ${target} around ${when}`;
    }
  }
}
