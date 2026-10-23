import type { FastRecord, TrackableDefinition, TrackableEntry } from '../db';
import { fastHours, goalMet } from './fastingJourney';
import { addDays, startOfDay } from './time';

// Insights > Year in review: a year at a glance from the data the app already
// has. Pure, so unit tested in tests/yearReview.test.ts.

type Fast = Pick<FastRecord, 'startTime' | 'endTime' | 'targetHours'>;
type Trackable = Pick<TrackableDefinition, 'id' | 'name' | 'icon' | 'displayMode'>;
type Entry = Pick<TrackableEntry, 'trackableId' | 'timestamp'>;

export interface YearReview {
  year: number;
  /** The year isn't over yet: totals so far. */
  partial: boolean;
  fasting: {
    /** Finished fasts that started in the year. */
    fasts: number;
    goalFasts: number;
    /** Days with a fast started. */
    daysFasted: number;
    hours: number;
    longestHours: number;
    /** The longest run of days in a row with a goal fast, inside the year. */
    longestGoalStreak: number;
  };
  /** Entries of trackables, dates trackables left out (their entries are dates, not things done). */
  logging: {
    entries: number;
    daysLogged: number;
    /** The trackables logged on the most days, at most three. */
    top: Array<{ id: string; name: string; icon: string; days: number }>;
  };
  /** The month with the most fasts and entries together, e.g. "March". Null with nothing logged. */
  busiestMonth: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The years with any fast or entry, newest first, always including the current year. */
export function reviewYears(fasts: readonly Fast[], entries: readonly Entry[], now: number): number[] {
  const years = new Set<number>([new Date(now).getFullYear()]);
  for (const f of fasts) if (f.startTime <= now) years.add(new Date(f.startTime).getFullYear());
  for (const e of entries) if (e.timestamp <= now) years.add(new Date(e.timestamp).getFullYear());
  return [...years].sort((a, b) => b - a);
}

/** The longest run of consecutive days in a set of local start-of-days. */
function longestRun(days: Set<number>): number {
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // not the start of a run
    let run = 1;
    while (days.has(addDays(d, run))) run++;
    best = Math.max(best, run);
  }
  return best;
}

export function yearReview(
  year: number,
  fasts: readonly Fast[],
  trackables: readonly Trackable[],
  entries: readonly Entry[],
  now: number,
): YearReview {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const inYear = (t: number) => t >= start && t < end && t <= now;

  const finished = fasts.filter((f) => f.endTime != null && inYear(f.startTime));
  const goalFasts = finished.filter((f) => goalMet(f, now));
  const fastDays = new Set(finished.map((f) => startOfDay(f.startTime)));
  const goalDays = new Set(goalFasts.map((f) => startOfDay(f.startTime)));

  const counted = new Set(trackables.filter((t) => t.displayMode !== 'ages').map((t) => t.id));
  const logged = entries.filter((e) => counted.has(e.trackableId) && inYear(e.timestamp));
  const daysByTrackable = new Map<string, Set<number>>();
  for (const e of logged) {
    const set = daysByTrackable.get(e.trackableId) ?? new Set<number>();
    set.add(startOfDay(e.timestamp));
    daysByTrackable.set(e.trackableId, set);
  }
  const byId = new Map(trackables.map((t) => [t.id, t] as const));
  const top = [...daysByTrackable.entries()]
    .map(([id, days]) => ({ id, name: byId.get(id)?.name ?? '', icon: byId.get(id)?.icon ?? '', days: days.size }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
    .slice(0, 3);

  const perMonth = new Array(12).fill(0);
  for (const f of finished) perMonth[new Date(f.startTime).getMonth()]++;
  for (const e of logged) perMonth[new Date(e.timestamp).getMonth()]++;
  const most = Math.max(...perMonth);

  return {
    year,
    partial: now < end,
    fasting: {
      fasts: finished.length,
      goalFasts: goalFasts.length,
      daysFasted: fastDays.size,
      hours: finished.reduce((sum, f) => sum + fastHours(f, now), 0),
      longestHours: finished.reduce((max, f) => Math.max(max, fastHours(f, now)), 0),
      longestGoalStreak: longestRun(goalDays),
    },
    logging: {
      entries: logged.length,
      daysLogged: new Set(logged.map((e) => startOfDay(e.timestamp))).size,
      top,
    },
    busiestMonth: most > 0 ? MONTHS[perMonth.indexOf(most)] : null,
  };
}
