import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import { goalStatus, type GoalState } from './trackableGoals';
import { resolveKind } from './trackableKinds';
import { dateItemKey, dateReminderText, datesDueSoon } from './dates';
import type { ScheduleInput } from './fastingSchedule';

// What needs attention right now: the in-app reminders (stores/attention.svelte.ts).

export interface AttentionItem {
  /** Unique in the list: the trackable's id, or with the date's entry for a dates trackable. */
  key: string;
  /** The trackable it links to. */
  id: string;
  name: string;
  icon: string;
  color: string;
  /** The goal status, e.g. "Overdue by 2d", "Due today", "1 of 3 this week", or a date's "Turns 61 in 3 days". */
  text: string;
  state: GoalState;
  urgency: number;
}

export interface Snapshot {
  trackables: TrackableDefinition[];
  fields: FieldDefinition[];
  entries: TrackableEntry[];
  recentFasts: FastRecord[];
  /** The fasting schedule: the settings, for the daily time and the weekly plan (utils/fastingSchedule.ts). */
  scheduleTime: ScheduleInput;
}

/**
 * Overdue and due goals of trackables that aren't archived, and dates inside
 * their trackable's lead time, most urgent first. A date today ranks with a
 * goal due today; later dates after it.
 */
export function attentionItems(snapshot: Snapshot, now: number): AttentionItem[] {
  const byTrackable = new Map<string, TrackableEntry[]>();
  for (const e of snapshot.entries) {
    const list = byTrackable.get(e.trackableId);
    if (list) list.push(e);
    else byTrackable.set(e.trackableId, [e]);
  }
  const items: AttentionItem[] = [];
  for (const t of snapshot.trackables) {
    if (t.archived || !t.goalType) continue;
    const fields = t.fieldIds.map((id) => snapshot.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
    if (resolveKind(t, fields).kind === 'ages') continue;
    const status = goalStatus(t, byTrackable.get(t.id) ?? [], fields, now);
    if (status && (status.state === 'overdue' || status.state === 'due')) {
      items.push({ key: t.id, id: t.id, name: t.name, icon: t.icon, color: t.color, text: status.text, state: status.state, urgency: status.urgency });
    }
  }
  const datesTrackables = snapshot.trackables.filter((t) => !t.archived && t.displayMode === 'ages');
  for (const d of datesDueSoon(datesTrackables, snapshot.entries, now)) {
    items.push({ key: dateItemKey(d), id: d.trackableId, name: d.name, icon: d.icon, color: d.color, text: dateReminderText(d), state: 'due', urgency: 10 + d.daysUntil });
  }
  return items.sort((a, b) => a.urgency - b.urgency || a.name.localeCompare(b.name));
}
