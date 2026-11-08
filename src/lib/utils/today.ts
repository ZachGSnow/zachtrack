import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import { goalStatus, offDayReason, type GoalStatus } from './trackableGoals';
import { resolveKind, summarize, type TrackableKind } from './trackableKinds';
import { upcomingDates, type DateItem } from './dates';
import { DAY_MS, startOfDay } from './time';

// What the Today screen shows (routes/Today.svelte): the habits with a goal,
// the trackables you've been logging lately, and the dates coming up. Pure,
// so unit tested in tests/today.test.ts.

export interface TodayHabit {
  trackable: TrackableDefinition;
  fields: FieldDefinition[];
  entries: TrackableEntry[];
  kind: TrackableKind;
  goal: GoalStatus | null;
  /** Today doesn't count for the goal: a rest day, skipped, or paused. */
  offDay: 'paused' | 'skipped' | 'rest' | null;
}

export interface TodayLog {
  trackable: TrackableDefinition;
  fields: FieldDefinition[];
  entries: TrackableEntry[];
  kind: TrackableKind;
  /** The card line: "192.4 lb, 2d ago", "Nothing today, last 3d ago". */
  summary: string;
  lastAt: number;
}

/** A trackable without a goal stays on Today while it was logged this recently. */
export const LOG_RECENT_DAYS = 30;
/** Dates this far ahead are listed under Coming up. */
export const DATES_WITHIN_DAYS = 14;

export function attachedFields(t: TrackableDefinition, fields: readonly FieldDefinition[]): FieldDefinition[] {
  return t.fieldIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
}

export function entriesByTrackable(entries: readonly TrackableEntry[]): Map<string, TrackableEntry[]> {
  const map = new Map<string, TrackableEntry[]>();
  for (const e of entries) {
    const list = map.get(e.trackableId);
    if (list) list.push(e);
    else map.set(e.trackableId, [e]);
  }
  return map;
}

const isHabit = (t: TrackableDefinition) => !!t.goalType && t.goalType !== 'avoid';

/**
 * Every trackable with a goal (other than avoid), most urgent first: overdue,
 * due, in progress, then done; rest, skipped and paused days last.
 */
export function todayHabits(
  trackables: readonly TrackableDefinition[],
  fields: readonly FieldDefinition[],
  entries: readonly TrackableEntry[],
  now: number,
): TodayHabit[] {
  const byId = entriesByTrackable(entries);
  const today = startOfDay(now);
  const habits: TodayHabit[] = [];
  for (const t of trackables) {
    if (t.archived || !isHabit(t)) continue;
    const attached = attachedFields(t, fields);
    const kind = resolveKind(t, attached).kind;
    if (kind === 'ages') continue;
    const own = byId.get(t.id) ?? [];
    habits.push({ trackable: t, fields: attached, entries: own, kind, goal: goalStatus(t, own, attached, now), offDay: offDayReason(t, today) });
  }
  return habits.sort(
    (a, b) =>
      Number(a.offDay != null) - Number(b.offDay != null) ||
      (a.goal?.urgency ?? Infinity) - (b.goal?.urgency ?? Infinity) ||
      a.trackable.name.localeCompare(b.trackable.name),
  );
}

/**
 * The trackables without a goal that you've logged in the last LOG_RECENT_DAYS
 * days, most recently logged first. Dormant ones stay on the Trackables list.
 */
export function todayLogs(
  trackables: readonly TrackableDefinition[],
  fields: readonly FieldDefinition[],
  entries: readonly TrackableEntry[],
  now: number,
  days: number = LOG_RECENT_DAYS,
): TodayLog[] {
  const byId = entriesByTrackable(entries);
  const since = now - days * DAY_MS;
  const logs: TodayLog[] = [];
  for (const t of trackables) {
    if (t.archived || isHabit(t)) continue;
    const attached = attachedFields(t, fields);
    const kind = resolveKind(t, attached).kind;
    if (kind === 'ages') continue;
    const own = (byId.get(t.id) ?? []).filter((e) => e.timestamp <= now);
    const lastAt = own.reduce((max, e) => Math.max(max, e.timestamp), 0);
    if (lastAt < since) continue;
    logs.push({ trackable: t, fields: attached, entries: own, kind, summary: summarize(kind, own, attached, now).card, lastAt });
  }
  return logs.sort((a, b) => b.lastAt - a.lastAt || a.trackable.name.localeCompare(b.trackable.name));
}

/** The next two weeks of dates from every dates trackable, soonest first. */
export function todayDates(trackables: readonly TrackableDefinition[], entries: readonly TrackableEntry[], now: number): DateItem[] {
  const dates = trackables.filter((t) => !t.archived && t.displayMode === 'ages');
  return dates.length ? upcomingDates(dates, entries, now, DATES_WITHIN_DAYS) : [];
}

// ---------------------------------------------------------------------------
// Goal suggestions (3.47): a trackable logged often but without a goal is
// offered one on Today, from how often it is actually logged.
// ---------------------------------------------------------------------------

export interface GoalSuggestion {
  trackable: TrackableDefinition;
  goalType: 'perDay' | 'everyDays';
  goalValue: number;
  /** "Once a day", "Every 3 days". */
  label: string;
  /** "9 of the last 14 days": how often it was logged. */
  reason: string;
  /** Days logged in the window, for ranking. */
  days: number;
}

/** Days logged in the last SUGGEST_WINDOW days before a suggestion is made. */
export const SUGGEST_MIN_DAYS = 5;
export const SUGGEST_WINDOW = 14;
/** Logged on this many of the window's days: every day. */
const DAILY_DAYS = 10;

export function suggestGoals(
  trackables: readonly TrackableDefinition[],
  entries: readonly TrackableEntry[],
  now: number,
): GoalSuggestion[] {
  const byId = entriesByTrackable(entries);
  const today = startOfDay(now);
  const windowStart = today - (SUGGEST_WINDOW - 1) * DAY_MS;
  const out: GoalSuggestion[] = [];
  for (const t of trackables) {
    if (t.archived || t.goalType || t.displayMode === 'ages') continue;
    const days = [...new Set((byId.get(t.id) ?? []).filter((e) => e.timestamp <= now).map((e) => startOfDay(e.timestamp)))].sort((a, b) => a - b);
    const recent = days.filter((d) => d >= windowStart);
    if (recent.length < SUGGEST_MIN_DAYS) continue;
    const reason = `${recent.length} of the last ${SUGGEST_WINDOW} days`;
    if (recent.length >= DAILY_DAYS) {
      out.push(
        t.fieldIds.length === 0
          ? { trackable: t, goalType: 'perDay', goalValue: 1, label: 'Once a day', reason, days: recent.length }
          : { trackable: t, goalType: 'everyDays', goalValue: 1, label: 'Every day', reason, days: recent.length },
      );
      continue;
    }
    // The usual gap between logged days over the window, rounded: every N days.
    const gaps = recent.slice(1).map((d, i) => Math.round((d - recent[i]) / DAY_MS)).sort((a, b) => a - b);
    const n = Math.max(2, Math.min(14, gaps[Math.floor(gaps.length / 2)] ?? 2));
    out.push({ trackable: t, goalType: 'everyDays', goalValue: n, label: `Every ${n} days`, reason, days: recent.length });
  }
  // The most regular first.
  return out.sort((a, b) => b.days - a.days || a.trackable.name.localeCompare(b.trackable.name));
}

// ---------------------------------------------------------------------------
// Time of day (3.48): Today groups habits by when they're usually logged.
// ---------------------------------------------------------------------------

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';
export const TIME_OF_DAY_ORDER: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Anytime' };

/**
 * When a trackable is usually logged, from its entries in the last 30 days:
 * the median hour (morning before noon, afternoon before 5 PM, evening
 * after), or anytime with fewer than 3 entries or when the middle half of
 * them spreads over more than 6 hours.
 */
export function timeOfDay(entries: readonly { timestamp: number }[], now: number): TimeOfDay {
  const since = now - 30 * DAY_MS;
  const hours = entries
    .filter((e) => e.timestamp > since && e.timestamp <= now)
    .map((e) => {
      const d = new Date(e.timestamp);
      return d.getHours() + d.getMinutes() / 60;
    })
    .sort((a, b) => a - b);
  if (hours.length < 3) return 'anytime';
  const q = (p: number) => hours[Math.min(hours.length - 1, Math.floor(p * hours.length))];
  if (q(0.75) - q(0.25) > 6) return 'anytime';
  const median = q(0.5);
  return median < 12 ? 'morning' : median < 17 ? 'afternoon' : 'evening';
}

/** Habits grouped by time of day, in day order, each group keeping the habits' own order. */
export function groupByTimeOfDay(habits: readonly TodayHabit[], now: number): Array<{ time: TimeOfDay; habits: TodayHabit[] }> {
  const groups = new Map<TimeOfDay, TodayHabit[]>();
  for (const h of habits) {
    const t = timeOfDay(h.entries, now);
    groups.set(t, [...(groups.get(t) ?? []), h]);
  }
  return TIME_OF_DAY_ORDER.filter((t) => groups.has(t)).map((time) => ({ time, habits: groups.get(time)! }));
}
