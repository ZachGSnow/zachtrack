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

/** "\u25bc0.3 lb/wk over 30 days", "about level over 30 days". */
export function describeTrend(perWeek: number | null, unit: string | undefined): string | null {
  if (perWeek == null) return null;
  const u = unit ? ` ${unit}` : '';
  if (Math.abs(perWeek) < FLAT_PER_WEEK) return `About level over the last ${TREND_DAYS} days`;
  const n = Math.abs(perWeek) < 1 ? nf2.format(Math.abs(perWeek)) : nf1.format(Math.abs(perWeek));
  return `${perWeek > 0 ? '\u25b2' : '\u25bc'}${n}${u}/wk over the last ${TREND_DAYS} days`;
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

/** Which way is good for a measurement with a goal: down when the goal is below the current average. */
export type GoodDirection = 'up' | 'down';

export function goalDirection(current: number | null | undefined, goal: number | null | undefined): GoodDirection | null {
  if (current == null || goal == null || Math.abs(goal - current) < 0.25) return null;
  return goal < current ? 'down' : 'up';
}

/** Whether a change is toward the goal (`good`), away from it (`bad`), or neither. Tiny changes are neither. */
export function changeTone(change: number | null | undefined, direction: GoodDirection | null): 'good' | 'bad' | null {
  if (change == null || direction == null || Math.abs(change) < 0.05) return null;
  return (change < 0) === (direction === 'down') ? 'good' : 'bad';
}

/** A 7-day average for each of `days` (local start-of-days), from a field's values by day; null where the week had none. */
export function rollingSeries(byDay: ReadonlyMap<number, number>, days: readonly number[], window: number = AVERAGE_DAYS): (number | null)[] {
  return days.map((d) => {
    const v = rollingAverage(byDay, d, window);
    return v == null ? null : Math.round(v * 100) / 100;
  });
}

// ---------------------------------------------------------------------------
// The smoothed trend and a goal range (3.54), as Happy Scale and The Hacker's
// Diet do it: an exponentially smoothed weight that moves a tenth of the way
// toward each new reading, so a single heavy morning barely shifts it.
// ---------------------------------------------------------------------------

/** How far the smoothed trend moves toward each reading. */
export const SMOOTHING = 0.1;

export type TrendMode = 'average' | 'smoothed';

/** The smoothed trend on each of `days`: carried over days without a reading; null before the first. */
export function smoothedSeries(byDay: ReadonlyMap<number, number>, days: readonly number[], alpha: number = SMOOTHING): (number | null)[] {
  const readings = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  let trend: number | null = null;
  let i = 0;
  return days.map((d) => {
    while (i < readings.length && readings[i][0] <= d) {
      const v = readings[i][1];
      trend = trend == null ? v : trend + alpha * (v - trend);
      i += 1;
    }
    return trend == null ? null : Math.round(trend * 100) / 100;
  });
}

/** The smoothed trend on `now`'s day, or null with no readings. */
export function smoothedNow(byDay: ReadonlyMap<number, number>, now: number): number | null {
  return smoothedSeries(byDay, [startOfDay(now)])[0];
}

/** The trend in the chosen mode now, and a week earlier, for the header line. */
export function trendNow(byDay: ReadonlyMap<number, number>, now: number, mode: TrendMode): { current: number; weekAgo: number | null } | null {
  if (mode === 'average') {
    const a = weeklyAverages(byDay, now);
    return a ? { current: a.current, weekAgo: a.previous } : null;
  }
  const current = smoothedNow(byDay, now);
  if (current == null) return null;
  return { current, weekAgo: smoothedNow(byDay, addDays(startOfDay(now), -AVERAGE_DAYS)) };
}

/** The trend's slope per week and its standard error, from the same 30-day fit as trendPerWeek. */
export function trendFit(byDay: ReadonlyMap<number, number>, now: number, days: number = TREND_DAYS): { perWeek: number; sePerWeek: number } | null {
  const today = startOfDay(now);
  const since = addDays(today, -(days - 1));
  const points: Array<[number, number]> = [];
  for (const [day, v] of byDay) if (day >= since && day <= today) points.push([Math.round((day - since) / DAY_MS), v]);
  if (points.length < MIN_TREND_POINTS) return null;
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx;
  const residual = points.reduce((s, [x, y]) => s + (y - (my + slope * (x - mx))) ** 2, 0);
  const se = Math.sqrt(residual / Math.max(1, n - 2) / sxx);
  return { perWeek: slope * 7, sePerWeek: se * 7 };
}

/**
 * The goal date as a range: the date at the fitted rate, and the dates at the
 * rate one standard error faster and slower. `latest` is missing when the
 * slower rate wouldn't reach the goal at all.
 */
export function projectGoalRange(
  current: number,
  goal: number,
  fit: { perWeek: number; sePerWeek: number } | null,
  now: number,
): (GoalProjection & { earliest?: number; latest?: number }) | null {
  const p = projectGoal(current, goal, fit?.perWeek ?? null, now);
  if (!p || p.kind !== 'toward' || !fit) return p;
  const gap = goal - current;
  const at = (rate: number) => {
    if (Math.sign(rate) !== Math.sign(gap) || Math.abs(rate) < FLAT_PER_WEEK) return undefined;
    const weeks = gap / rate;
    return weeks > 260 ? undefined : addDays(startOfDay(now), Math.round(weeks * 7));
  };
  const faster = fit.perWeek + Math.sign(fit.perWeek) * fit.sePerWeek;
  const slower = fit.perWeek - Math.sign(fit.perWeek) * fit.sePerWeek;
  return { ...p, earliest: at(faster), latest: at(slower) };
}

/** " (Feb 20 to Apr 30)", " (Feb 20 or later)" without a slower date, or "" when the range is a single day. */
export function describeRange(p: { at: number; earliest?: number; latest?: number }): string {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
  };
  if (p.earliest == null || (p.latest != null && p.earliest === p.latest)) return '';
  return p.latest != null ? ` (${fmt(p.earliest)} to ${fmt(p.latest)})` : ` (${fmt(p.earliest)} or later)`;
}
