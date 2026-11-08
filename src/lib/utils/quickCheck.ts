import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import { goalStatus, type GoalStatus } from './trackableGoals';
import type { TrackableKind } from './trackableKinds';
import { startOfDay } from './time';

// What the check button on a goal card (and a Today habit row) is in: logged
// today or not, how many times, and what a tap does. Pure, shared by
// TrackableCard.svelte and HabitRow.svelte through CheckButton.svelte.

export interface CheckState {
  /** A goal other than avoid on a trackable that isn't dates: gets the check button and grid strip. */
  goalCard: boolean;
  /** No fields: a tap logs it right away; a second tap on a done day takes it back. */
  noFields: boolean;
  loggedToday: boolean;
  /** Times per day, two or more: the button counts taps. */
  multiple: boolean;
  todayCount: number;
  doneToday: boolean;
  /** Progress toward today's total or count while it isn't met; null for a plain check. */
  ring: number | null;
  /** The button's accessible name, e.g. "Check Water for today", "Log one Water (1 of 3 today)". */
  label: string;
  goal: GoalStatus | null;
}

export function checkState(
  trackable: TrackableDefinition,
  kind: TrackableKind,
  entries: readonly TrackableEntry[],
  fields: readonly FieldDefinition[],
  now: number,
): CheckState {
  const goal = kind === 'ages' ? null : goalStatus(trackable, entries, fields, now);
  const goalCard = !!trackable.goalType && trackable.goalType !== 'avoid' && kind !== 'ages';
  const noFields = trackable.fieldIds.length === 0;
  const today = startOfDay(now);
  const todayCount = entries.filter((e) => startOfDay(e.timestamp) === today).length;
  const loggedToday = todayCount > 0;
  const multiple = trackable.goalType === 'perDay' && (trackable.goalValue ?? 1) > 1;
  const counted = trackable.goalType === 'dailyTotal' || multiple;
  const doneToday = counted ? goal?.state === 'done' : loggedToday;
  const ring = counted && !doneToday ? (goal?.progress ?? 0) : null;
  const label = !noFields
    ? `Log ${trackable.name}`
    : doneToday
      ? `Uncheck ${trackable.name} for today`
      : multiple
        ? `Log one ${trackable.name} (${todayCount} of ${trackable.goalValue} today)`
        : `Check ${trackable.name} for today`;
  return { goalCard, noFields, loggedToday, multiple, todayCount, doneToday, ring, label, goal };
}
