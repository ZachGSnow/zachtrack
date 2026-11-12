import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import type { SyncHistoryEntry } from './syncHistory';
import { DAILY_GOALS, goalField, offDayReason } from './trackableGoals';
import { computeFieldValuesByDay } from './trackableStats';
import { dateKindOf, nextOccurrence } from './dates';
import { goalHours } from './fastingJourney';
import { addDays, formatClockTime, startOfDay } from './time';

// "Since you were last here" on Today (ARCHITECTURE.md 3.52). The app has no
// push notifications by design, so a reminder only works if you open it; after
// a long gap, Today says what happened while you were away: habit days missed,
// a fast that reached its goal, dates that went by, and changes that arrived
// from other devices. Pure; tests/sinceLastVisit.test.ts.

/** Away at least this long and the card shows. */
export const AWAY_HOURS = 12;
/** At most this many lines. */
export const MAX_LINES = 6;

export interface AwayLine {
  icon: string;
  text: string;
}

export interface AwayInput {
  lastActive: number;
  now: number;
  trackables: readonly TrackableDefinition[];
  fields: readonly FieldDefinition[];
  entries: readonly TrackableEntry[];
  fasts: readonly Pick<FastRecord, 'startTime' | 'endTime' | 'targetHours' | 'presetLabel'>[];
  syncLog: readonly Pick<SyncHistoryEntry, 'completedAt' | 'outcome' | 'details' | 'moreDetailsCount'>[];
}

const weekday = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });

export function sinceLastVisit(i: AwayInput): AwayLine[] {
  if (i.now - i.lastActive < AWAY_HOURS * 3600_000) return [];
  const lines: AwayLine[] = [];
  const firstDay = startOfDay(i.lastActive);
  const yesterday = addDays(startOfDay(i.now), -1);

  // Fasts that reached their goal while you were away.
  for (const f of i.fasts) {
    const goalAt = f.startTime + goalHours(f) * 3600_000;
    const reached = f.endTime == null || f.endTime >= goalAt;
    if (reached && goalAt > i.lastActive && goalAt <= i.now) {
      lines.push({ icon: '\u23F1\uFE0F', text: `Your ${f.presetLabel ?? 'count-up'} fast reached its goal ${weekday(goalAt)} at ${formatClockTime(goalAt)}` });
    }
  }

  // Daily goals missed on the days you were away (today is still open).
  const byId = new Map<string, TrackableEntry[]>();
  for (const e of i.entries) {
    const list = byId.get(e.trackableId);
    if (list) list.push(e);
    else byId.set(e.trackableId, [e]);
  }
  for (const t of i.trackables) {
    if (t.archived || t.displayMode === 'ages' || !t.goalType || !DAILY_GOALS.includes(t.goalType) || !t.goalValue) continue;
    const own = byId.get(t.id) ?? [];
    const attached = t.fieldIds.map((id) => i.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
    const totalField = t.goalType === 'dailyTotal' ? goalField(attached) : undefined;
    const totals = totalField ? computeFieldValuesByDay(own, totalField) : null;
    let missed = 0;
    for (let d = Math.max(firstDay, startOfDay(t.createdAt)); d <= yesterday; d = addDays(d, 1)) {
      if (offDayReason(t, d)) continue;
      const value = totals ? (totals.get(d) ?? 0) : own.filter((e) => startOfDay(e.timestamp) === d).length;
      if (value < t.goalValue) missed += 1;
    }
    if (missed > 0) lines.push({ icon: t.icon, text: `${t.name}: ${missed} ${missed === 1 ? 'day' : 'days'} missed` });
  }

  // Dates that went by.
  const dated = new Map(i.trackables.filter((t) => !t.archived && t.displayMode === 'ages').map((t) => [t.id, t] as const));
  for (const e of i.entries) {
    const t = dated.get(e.trackableId);
    if (!t) continue;
    const { at, past } = nextOccurrence(e, dateKindOf(t), i.lastActive);
    if (!past && at > firstDay && at < startOfDay(i.now)) lines.push({ icon: t.icon, text: `${e.note?.trim() || 'Untitled'} was ${weekday(at)}` });
  }

  // What arrived from your other devices.
  const received = i.syncLog
    .filter((r) => r.outcome === 'success' && r.completedAt > i.lastActive && r.completedAt <= i.now)
    .reduce((n, r) => n + (r.details?.length ?? 0) + (r.moreDetailsCount ?? 0), 0);
  if (received > 0) lines.push({ icon: '\u{1F504}', text: `${received} ${received === 1 ? 'change' : 'changes'} arrived from your other devices` });

  return lines.slice(0, MAX_LINES);
}
