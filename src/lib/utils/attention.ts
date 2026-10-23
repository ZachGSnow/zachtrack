import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
import { goalStatus, type GoalState } from './trackableGoals';
import { resolveKind } from './trackableKinds';

// What needs attention right now: the in-app reminders (stores/attention.svelte.ts).

export interface AttentionItem {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** The goal status, e.g. "Overdue by 2d", "Due today", "1 of 3 this week". */
  text: string;
  state: GoalState;
  urgency: number;
}

export interface Snapshot {
  trackables: TrackableDefinition[];
  fields: FieldDefinition[];
  entries: TrackableEntry[];
  recentFasts: FastRecord[];
  scheduleTime: string | undefined;
}

/** Overdue and due goals of trackables that aren't archived, most urgent first. */
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
      items.push({ id: t.id, name: t.name, icon: t.icon, color: t.color, text: status.text, state: status.state, urgency: status.urgency });
    }
  }
  return items.sort((a, b) => a.urgency - b.urgency || a.name.localeCompare(b.name));
}
