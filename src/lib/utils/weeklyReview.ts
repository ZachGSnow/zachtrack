import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import { DAILY_GOALS, goalField, goalStatus, offDayReason } from './trackableGoals';
import { bucketStart, computeFieldValuesByDay } from './trackableStats';
import { goalMet } from './fastingJourney';
import { rollingAverage } from './measurement';
import { addDays, startOfDay } from './time';

// The weekly review on Today (3.48): on Sunday the week so far, on Monday the
// week that just ended. Habits met, the weight average's change, and fasts.
// Pure; tests/weeklyReview.test.ts.

export interface WeeklyReview {
  /** Monday of the week reviewed (local start-of-day). */
  weekStart: number;
  /** The week isn't over yet (shown on its Sunday). */
  partial: boolean;
  /** Daily goals: scheduled days met, of scheduled days. Weekly and every-N-days goals count once each. */
  habits: { met: number; of: number } | null;
  /** The weight field's 7-day average at the week's end, and its change from a week earlier. */
  weight: { average: number; change: number | null; unit?: string } | null;
  fasts: { count: number; goal: number };
}

/** The Monday of the week to review on `now`: this week on a Sunday, last week on a Monday, else null. */
export function reviewWeekStart(now: number): number | null {
  const day = new Date(now).getDay(); // 0 = Sunday
  const monday = bucketStart(now, 'week');
  if (day === 0) return monday;
  if (day === 1) return addDays(monday, -7);
  return null;
}

export function weeklyReview(
  trackables: readonly TrackableDefinition[],
  fields: readonly FieldDefinition[],
  entries: readonly TrackableEntry[],
  fasts: readonly Pick<FastRecord, 'startTime' | 'endTime' | 'targetHours'>[],
  weightFieldId: string | undefined,
  now: number,
): WeeklyReview | null {
  const weekStart = reviewWeekStart(now);
  if (weekStart == null) return null;
  const today = startOfDay(now);
  const lastDay = Math.min(addDays(weekStart, 6), today);
  const partial = lastDay === today;

  // Habits: each scheduled day of a daily goal, and each weekly or every-N-days goal once.
  let met = 0;
  let of = 0;
  const byId = new Map<string, TrackableEntry[]>();
  for (const e of entries) byId.set(e.trackableId, [...(byId.get(e.trackableId) ?? []), e]);
  for (const t of trackables) {
    if (t.archived || !t.goalType || t.goalType === 'avoid' || t.displayMode === 'ages' || !t.goalValue) continue;
    const own = byId.get(t.id) ?? [];
    const attached = t.fieldIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
    if (DAILY_GOALS.includes(t.goalType)) {
      const totalField = t.goalType === 'dailyTotal' ? goalField(attached) : undefined;
      const totals = totalField ? computeFieldValuesByDay(own, totalField) : null;
      for (let d = weekStart; d <= lastDay; d = addDays(d, 1)) {
        if (offDayReason(t, d)) continue;
        const value = totals ? (totals.get(d) ?? 0) : own.filter((e) => startOfDay(e.timestamp) === d).length;
        if (d === today && value < t.goalValue) continue; // today is still open
        of += 1;
        if (value >= t.goalValue) met += 1;
      }
    } else if (t.goalType === 'perWeek') {
      const days = new Set(own.filter((e) => e.timestamp >= weekStart && e.timestamp < addDays(weekStart, 7)).map((e) => startOfDay(e.timestamp))).size;
      of += 1;
      if (days >= t.goalValue) met += 1;
    } else if (t.goalType === 'everyDays') {
      // On time at the week's end.
      const end = addDays(lastDay, 1) - 1;
      const status = goalStatus(t, own.filter((e) => e.timestamp <= end), attached, end);
      of += 1;
      if (status && status.state !== 'overdue') met += 1;
    }
  }

  const weightField = weightFieldId ? fields.find((f) => f.id === weightFieldId) : undefined;
  let weight: WeeklyReview['weight'] = null;
  if (weightField) {
    const byDay = computeFieldValuesByDay(entries.filter((e) => e.values?.[weightField.id] != null), weightField);
    const average = rollingAverage(byDay, lastDay);
    const before = rollingAverage(byDay, addDays(lastDay, -7));
    if (average != null) weight = { average, change: before == null ? null : average - before, unit: weightField.unit };
  }

  const inWeek = fasts.filter((f) => f.startTime >= weekStart && f.startTime < addDays(lastDay, 1) && f.endTime != null);
  return {
    weekStart,
    partial,
    habits: of ? { met, of } : null,
    weight,
    fasts: { count: inWeek.length, goal: inWeek.filter((f) => goalMet(f, now)).length },
  };
}
