// Splitting a trackable by field, and merging one into another (ARCHITECTURE.md
// 3.72): which entries go where. Pure; the moves are in db/records.ts and the
// sheet in SplitMergeSection.svelte. Tests: tests/trackableSplit.test.ts.

import type { TrackableDefinition, TrackableEntry } from '../db';

/** The fields an entry has a value for, among the trackable's own. */
export function fieldsLogged(entry: Pick<TrackableEntry, 'values'>, fieldIds: readonly string[]): string[] {
  return fieldIds.filter((id) => entry.values?.[id] != null);
}

export interface SplitPlan {
  /** Per field, in the trackable's order: the entries that only have that field. */
  parts: Array<{ fieldId: string; entryIds: string[] }>;
  /** Entries with several of the fields, or none: they stay where they are. */
  staying: string[];
}

/** Each entry with exactly one of the fields goes to that field's new trackable; the rest stay. */
export function planSplit(trackable: Pick<TrackableDefinition, 'fieldIds'>, entries: readonly Pick<TrackableEntry, 'id' | 'values'>[]): SplitPlan {
  const parts = trackable.fieldIds.map((fieldId) => ({ fieldId, entryIds: [] as string[] }));
  const staying: string[] = [];
  for (const e of entries) {
    const logged = fieldsLogged(e, trackable.fieldIds);
    if (logged.length === 1) parts.find((p) => p.fieldId === logged[0])!.entryIds.push(e.id);
    else staying.push(e.id);
  }
  return { parts, staying };
}

/** Whether a trackable can be split: two or more fields, and not a dates trackable. */
export function canSplit(trackable: Pick<TrackableDefinition, 'fieldIds' | 'displayMode'>): boolean {
  return trackable.fieldIds.length >= 2 && trackable.displayMode !== 'ages';
}

/** The trackables a trackable can be merged into: any other one that isn't archived or a dates trackable. */
export function mergeTargets<T extends Pick<TrackableDefinition, 'id' | 'archived' | 'displayMode' | 'name'>>(trackable: Pick<TrackableDefinition, 'id' | 'displayMode'>, all: readonly T[]): T[] {
  if (trackable.displayMode === 'ages') return [];
  return all.filter((t) => t.id !== trackable.id && !t.archived && t.displayMode !== 'ages').sort((a, b) => a.name.localeCompare(b.name));
}

/** The target's fields after a merge: its own, then the source's it doesn't have, in order. */
export function mergedFieldIds(target: readonly string[], source: readonly string[]): string[] {
  return [...target, ...source.filter((id) => !target.includes(id))];
}
