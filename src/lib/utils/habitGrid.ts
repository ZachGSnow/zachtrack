import type { FieldDefinition, TrackableDefinition } from '../db';
import { addDays, startOfDay } from './time';
import { bucketStart, computeFieldValuesByDay, type TimestampedValues } from './trackableStats';
import { goalField } from './trackableGoals';

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
  /** An every-N-days goal fell overdue on this day. */
  missed: boolean;
}

/**
 * `weeks` whole weeks ending with the current one, as columns (oldest first)
 * of seven days, Monday to Sunday.
 */
export function habitGridWeeks(
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt'>,
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
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt'>,
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
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt'>,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  start: number,
  length: number,
  today: number,
): GridDay[] {
  const counts = new Map<number, number>();
  for (const e of entries) {
    const d = startOfDay(e.timestamp);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const loggedDays = [...counts.keys()].sort((a, b) => a - b);
  // A trackable can be created after entries it was given (an import), so start at whichever is first.
  const since = Math.min(startOfDay(trackable.createdAt), loggedDays[0] ?? Number.POSITIVE_INFINITY);

  const type = trackable.goalType;
  const goal = trackable.goalValue;
  const totalField = type === 'dailyTotal' ? goalField(fields) : undefined;
  const totals = totalField ? computeFieldValuesByDay(entries as TimestampedValues[], totalField) : null;
  const missed = type === 'everyDays' && goal ? missedDays(loggedDays, goal, today) : new Set<number>();

  const days: GridDay[] = [];
  for (let i = 0, d = start; i < length; i++, d = addDays(d, 1)) {
    const count = counts.get(d) ?? 0;
    const outside = d > today || d < since;
    let level = count > 0 ? 1 : 0;
    if (totals && goal) level = Math.max(0, Math.min(1, (totals.get(d) ?? 0) / goal));
    if (type === 'avoid') level = count > 0 ? 0 : 1;
    days.push({ day: d, level: outside ? 0 : level, count, isToday: d === today, outside, future: d > today, missed: missed.has(d) });
  }
  return days;
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
