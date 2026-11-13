import type { FieldDefinition, TrackableDefinition } from '../db';
import { addDays, startOfDay } from './time';
import { bucketStart, computeFieldValuesByDay, type TimestampedValues } from './trackableStats';
import { goalField, offDayReason } from './trackableGoals';

type GridTrackable = Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt' | 'scheduleDays' | 'skipDays' | 'pausedUntil'> & Partial<Pick<TrackableDefinition, 'scheduleHistory'>>;

/**
 * The habit grid (HabitGrid.svelte): one cell per day, whole weeks Monday to
 * Sunday, shaded by how far the day went toward the trackable's goal rather
 * than by a raw count.
 */

export interface GridDay {
  /** Local start-of-day. */
  day: number;
  /** 0 = nothing, 1 = fully done; in between for part of a daily total. */
  level: number;
  /** Entries that day. */
  count: number;
  isToday: boolean;
  /** After today, or before the trackable existed: not tappable, nothing to show. */
  outside: boolean;
  /** After today: drawn blank (days before the trackable existed are drawn faint instead). */
  future: boolean;
  /**
   * The goal wasn't met here (3.74): an every-N-days goal fell overdue, a
   * daily goal's day went by unmet, or the day is in a week a weekly goal
   * missed or an at-most goal went over. Drawn with a red tint when nothing
   * was logged.
   */
  missed: boolean;
  /** Logged, but counting against the goal: a slip on an avoid goal, or a day in a week over an at-most limit. Drawn red. */
  over: boolean;
  /** Why the day is red, for its label: "goal missed", "over the limit: 3 of at most 1 that week". */
  note?: string;
  /** Off the schedule, skipped or paused, with nothing logged: not a miss. */
  off: 'rest' | 'skipped' | 'paused' | null;
}

/**
 * `weeks` whole weeks ending with the current one, as columns (oldest first)
 * of seven days, Monday to Sunday.
 */
export function habitGridWeeks(
  trackable: GridTrackable,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  weeks: number,
  now: number = Date.now(),
): GridDay[][] {
  const today = startOfDay(now);
  const firstMonday = addDays(bucketStart(now, 'week'), -7 * (weeks - 1));
  return gridFor(trackable, entries, fields, firstMonday, weeks * 7, today).reduce<GridDay[][]>((cols, d, i) => {
    if (i % 7 === 0) cols.push([]);
    cols[cols.length - 1].push(d);
    return cols;
  }, []);
}

/** The weeks (Monday to Sunday) covering one calendar month, as rows: for the Month view. */
export function habitGridMonth(
  trackable: GridTrackable,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  monthStart: number,
  now: number = Date.now(),
): GridDay[][] {
  const first = new Date(monthStart);
  const firstOfMonth = new Date(first.getFullYear(), first.getMonth(), 1).getTime();
  const lastOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getTime();
  // From the Monday on or before the 1st to the Sunday on or after the last day.
  const start = bucketStart(firstOfMonth, 'week');
  const end = addDays(bucketStart(lastOfMonth, 'week'), 6);
  let length = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) length += 1;
  const all = gridFor(trackable, entries, fields, start, length, startOfDay(now));
  const rows: GridDay[][] = [];
  for (let i = 0; i < all.length; i += 7) rows.push(all.slice(i, i + 7));
  return rows;
}

function gridFor(
  trackable: GridTrackable,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  start: number,
  length: number,
  today: number,
  /** Days before the trackable existed are tappable too (the week matrix: a habit set up today may have been done yesterday). */
  anyPastDay = false,
): GridDay[] {
  const counts = new Map<number, number>();
  for (const e of entries) {
    const d = startOfDay(e.timestamp);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const loggedDays = [...counts.keys()].sort((a, b) => a - b);
  // A trackable can be created after entries it was given (an import), so start at whichever is first.
  const since = anyPastDay ? Number.NEGATIVE_INFINITY : Math.min(startOfDay(trackable.createdAt), loggedDays[0] ?? Number.POSITIVE_INFINITY);

  const type = trackable.goalType;
  const goal = trackable.goalValue;
  const totalField = type === 'dailyTotal' ? goalField(fields) : undefined;
  const totals = totalField ? computeFieldValuesByDay(entries as TimestampedValues[], totalField) : null;
  const missed = type === 'everyDays' && goal ? missedDays(loggedDays, goal, today) : new Set<number>();
  // Where the goal starts counting: the trackable's first day (or first entry), even where earlier days are drawn.
  const counted = Math.min(startOfDay(trackable.createdAt), loggedDays[0] ?? Number.POSITIVE_INFINITY);
  const weekNote = weeklyNotes(trackable, counts, counted, today);

  const days: GridDay[] = [];
  for (let i = 0, d = start; i < length; i++, d = addDays(d, 1)) {
    const count = counts.get(d) ?? 0;
    const outside = d > today || d < since;
    let level = count > 0 ? 1 : 0;
    if (totals && goal) level = Math.max(0, Math.min(1, (totals.get(d) ?? 0) / goal));
    if (type === 'perDay' && goal) level = Math.min(1, count / goal);
    if (type === 'avoid') level = count > 0 ? 0 : 1;
    const off = !outside && count === 0 ? offDayReason(trackable, d) : null;
    let isMissed = missed.has(d);
    let over = false;
    let note: string | undefined = isMissed ? 'overdue' : undefined;
    if (d <= today && d >= counted) {
      if ((type === 'dailyTotal' || type === 'perDay') && goal && d < today && level < 1 && !offDayReason(trackable, d)) {
        isMissed = true;
        note = 'goal missed';
      }
      if (type === 'avoid' && count > 0) {
        over = true;
        note = 'slipped';
      }
      const week = weekNote.get(bucketStart(d, 'week'));
      if (week) {
        isMissed = true;
        note = week;
        if (type === 'maxPerWeek' && count > 0) over = true;
      }
    }
    days.push({ day: d, level: outside ? 0 : level, count, isToday: d === today, outside, future: d > today, missed: isMissed, over, ...(note ? { note } : {}), off });
  }
  return days;
}

/**
 * Weeks (by their Monday) that count against a weekly goal, with why: a
 * times-per-week goal that ended short, or can no longer be reached this
 * week; an at-most goal that went over, for the rest of that week.
 */
function weeklyNotes(trackable: GridTrackable, counts: Map<number, number>, counted: number, today: number): Map<number, string> {
  const { goalType: type, goalValue: goal } = trackable;
  const notes = new Map<number, string>();
  if (!goal || (type !== 'perWeek' && type !== 'maxPerWeek')) return notes;
  const thisWeek = bucketStart(today, 'week');
  const firstWeek = bucketStart(counted === Number.POSITIVE_INFINITY ? today : counted, 'week');
  for (let w = firstWeek; w <= thisWeek; w = addDays(w, 7)) {
    let days = 0;
    let times = 0;
    let excused = false;
    for (let i = 0, d = w; i < 7; i++, d = addDays(d, 1)) {
      const n = counts.get(d) ?? 0;
      // A week with a paused or skipped day isn't held against the goal.
      if (d <= today && offDayReason(trackable, d)) excused = true;
      if (n > 0) days += 1;
      times += n;
    }
    if (type === 'maxPerWeek') {
      if (times > goal) notes.set(w, `over the limit: ${times} of at most ${goal} that week`);
      continue;
    }
    if (excused) continue;
    // Days left this week, today included unless it's already logged.
    const left = w === thisWeek ? 7 - Math.round((today - w) / 86_400_000) - ((counts.get(today) ?? 0) > 0 ? 1 : 0) : 0;
    if (days + left < goal) notes.set(w, `week missed: ${days} of ${goal} days`);
  }
  return notes;
}

/** The days an every-N-days goal fell overdue: N days after an entry with no entry since. */
function missedDays(loggedDays: number[], everyDays: number, today: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < loggedDays.length; i++) {
    const due = addDays(loggedDays[i], everyDays);
    const next = loggedDays[i + 1];
    if ((next == null || next > due) && due < today) out.add(due);
  }
  return out;
}

/** The `length` days ending today, as one row: the Today screen's "Last 7 days" matrix (HabitMatrix.svelte). */
export function habitGridDays(
  trackable: GridTrackable,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  length: number,
  now: number = Date.now(),
): GridDay[] {
  const today = startOfDay(now);
  return gridFor(trackable, entries, fields, addDays(today, -(length - 1)), length, today, true);
}
