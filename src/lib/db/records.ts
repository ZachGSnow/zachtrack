// Settings, fasts, fields, trackables and their entries.

import { startOfDay } from '../utils/time';
import { BODY_FIELD_ROLES, BODY_FIELD_SETTING, resolveBodyField } from '../utils/health';
import { type FastRecord, type FieldDefinition, type TrackableDefinition, type TrackableEntry, type SettingsRecord, DEFAULT_SETTINGS, DuplicateStartDayError } from './types';
import { db, uuid, notifyMutation, addTombstone } from './schema';
import { canSplit, mergedFieldIds, planSplit } from '../utils/trackableSplit';

export async function getSettings(): Promise<SettingsRecord> {
  const existing = await db.settings.get('app-settings');
  if (existing) return existing;
  // updatedAt 0, not now: these are defaults, not an edit. A new device pushes
  // its whole dataset on its first sync, and "now" would make the defaults win
  // last-write-wins and reset the height/goal weight other devices synced.
  const fresh: SettingsRecord = { ...DEFAULT_SETTINGS, updatedAt: 0 };
  await db.settings.put(fresh);
  return fresh;
}

export async function updateSettings(patch: Partial<SettingsRecord>): Promise<SettingsRecord> {
  const current = await getSettings();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await db.settings.put(next);
  notifyMutation();
  return next;
}

/** Returns the currently active (unfinished) fast, if any. */
export async function getActiveFast(): Promise<FastRecord | undefined> {
  return db.fasts.filter((f) => f.endTime == null).first();
}

/** Returns the fast (if any) whose start date is the given calendar day, excluding `excludeId`. */
export async function getFastForDay(day: number, excludeId?: number): Promise<FastRecord | undefined> {
  const match = await db.fasts.where('startDay').equals(day).first();
  if (match && match.id === excludeId) return undefined;
  return match;
}

/** Creates a new fast, throwing `DuplicateStartDayError` if another fast already starts that day. */
export async function addFast(record: Omit<FastRecord, 'id' | 'startDay' | 'uuid'>): Promise<FastRecord> {
  const startDay = startOfDay(record.startTime);
  const conflict = await getFastForDay(startDay);
  if (conflict) throw new DuplicateStartDayError();
  const full: FastRecord = { ...record, startDay, uuid: uuid() };
  const id = await db.fasts.add(full);
  notifyMutation();
  return { ...full, id };
}

/** Updates a fast, throwing `DuplicateStartDayError` if a start-time change collides with another fast. */
export async function updateFast(id: number, patch: Partial<FastRecord>): Promise<void> {
  if (patch.startTime != null) {
    const startDay = startOfDay(patch.startTime);
    const conflict = await getFastForDay(startDay, id);
    if (conflict) throw new DuplicateStartDayError();
    patch = { ...patch, startDay };
  }
  await db.fasts.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

export async function deleteFast(id: number): Promise<void> {
  const existing = await db.fasts.get(id);
  await db.fasts.delete(id);
  if (existing?.uuid) {
    const day = new Date(existing.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    await addTombstone('fasts', existing.uuid, `Fast from ${day}`);
  }
  notifyMutation();
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export async function createFieldDefinition(input: Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<FieldDefinition> {
  const now = Date.now();
  const field: FieldDefinition = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  await db.fieldDefinitions.add(field);
  notifyMutation();
  return field;
}

export async function updateFieldDefinition(
  id: string,
  patch: Partial<Omit<FieldDefinition, 'id' | 'createdAt'>>,
): Promise<void> {
  // Renaming a field BMI or body fat finds by its name ("Weight", "Waist",
  // ...) would turn them off, so pin it by id first. Once pinned, any name works.
  if (patch.name !== undefined) {
    const settings = await getSettings();
    const fields = await db.fieldDefinitions.toArray();
    const pins: Partial<SettingsRecord> = {};
    for (const role of BODY_FIELD_ROLES) {
      const key = BODY_FIELD_SETTING[role];
      if (!settings[key] && resolveBodyField(fields, role, undefined)?.id === id) pins[key] = id;
    }
    if (Object.keys(pins).length > 0) await updateSettings(pins);
  }
  await db.fieldDefinitions.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

export async function deleteFieldDefinition(id: string): Promise<void> {
  const existing = await db.fieldDefinitions.get(id);
  await db.fieldDefinitions.delete(id);
  await addTombstone('fieldDefinitions', id, existing?.name);
  // Detach from any trackables that referenced it.
  const affected = await db.trackableDefinitions.filter((t) => t.fieldIds.includes(id)).toArray();
  for (const t of affected) {
    await db.trackableDefinitions.update(t.id, {
      fieldIds: t.fieldIds.filter((f) => f !== id),
      updatedAt: Date.now(),
    });
  }
  notifyMutation();
}

// ---------------------------------------------------------------------------
// Trackable definitions
// ---------------------------------------------------------------------------

export async function createTrackable(
  input: Omit<TrackableDefinition, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<TrackableDefinition> {
  const now = Date.now();
  const trackable: TrackableDefinition = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  await db.trackableDefinitions.add(trackable);
  notifyMutation();
  return trackable;
}

export async function updateTrackable(id: string, patch: Partial<TrackableDefinition>): Promise<void> {
  await db.trackableDefinitions.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

/** What a split did, for Undo (`undoSplitTrackable`). */
export interface SplitResult {
  originalId: string;
  /** The new trackables, one per field, with the entries moved to each. */
  created: Array<{ id: string; fieldId: string; entryIds: string[] }>;
  /** The original was archived because no entries were left in it. */
  archived: boolean;
}

/**
 * Splits a trackable into one per field (3.72): each entry with only one of
 * the fields moves to that field's trackable, keeping its id, time, note and
 * values, so nothing is copied or lost and the move syncs as an edit. Entries
 * with several fields, or none, stay. `goalFieldId` picks the new trackable
 * that takes over the goal; the original is archived if it ends up empty.
 */
export async function splitTrackable(id: string, goalFieldId?: string): Promise<SplitResult> {
  const result = await db.transaction('rw', db.trackableDefinitions, db.trackableEntries, db.fieldDefinitions, async () => {
    const original = await db.trackableDefinitions.get(id);
    if (!original || !canSplit(original)) throw new Error('Only a trackable with two or more fields can be split.');
    const entries = await db.trackableEntries.where('trackableId').equals(id).toArray();
    const fields = await db.fieldDefinitions.bulkGet(original.fieldIds);
    const plan = planSplit(original, entries);
    const now = Date.now();
    const created: SplitResult['created'] = [];
    for (const [i, part] of plan.parts.entries()) {
      const goal =
        part.fieldId === goalFieldId
          ? {
              goalType: original.goalType,
              goalValue: original.goalValue,
              scheduleDays: original.scheduleDays,
              skipDays: original.skipDays,
              pausedUntil: original.pausedUntil,
              scheduleHistory: original.scheduleHistory,
            }
          : {};
      const trackable: TrackableDefinition = {
        id: uuid(),
        name: fields[i]?.name ?? `${original.name} ${i + 1}`,
        icon: original.icon,
        color: original.color,
        fieldIds: [part.fieldId],
        ...(original.displayMode ? { displayMode: original.displayMode } : {}),
        ...(original.pinned ? { pinned: true } : {}),
        ...(original.insightsHidden ? { insightsHidden: true } : {}),
        ...(original.sortOrder != null ? { sortOrder: original.sortOrder } : {}),
        ...Object.fromEntries(Object.entries(goal).filter(([, v]) => v !== undefined)),
        createdAt: now,
        updatedAt: now,
      };
      await db.trackableDefinitions.add(trackable);
      await moveEntries(part.entryIds, trackable.id, now);
      created.push({ id: trackable.id, fieldId: part.fieldId, entryIds: part.entryIds });
    }
    const archived = plan.staying.length === 0;
    const patch: Partial<TrackableDefinition> = { updatedAt: now };
    if (archived) patch.archived = true;
    // The goal went with one of the parts.
    if (goalFieldId && original.goalType) Object.assign(patch, { goalType: undefined, goalValue: undefined });
    await db.trackableDefinitions.update(id, patch);
    return { originalId: id, created, archived };
  });
  notifyMutation();
  return result;
}

/** Puts a split back: the entries return, the original comes back as it was, and the new trackables go. */
export async function undoSplitTrackable(split: SplitResult, original: TrackableDefinition): Promise<void> {
  await db.transaction('rw', db.trackableDefinitions, db.trackableEntries, db.syncTombstones, async () => {
    const now = Date.now();
    for (const part of split.created) await moveEntries(part.entryIds, split.originalId, now);
    await db.trackableDefinitions.put({ ...original, updatedAt: now });
    for (const part of split.created) {
      const left = await db.trackableEntries.where('trackableId').equals(part.id).count();
      // Anything logged to it since the split stays, with it.
      if (left > 0) continue;
      const t = await db.trackableDefinitions.get(part.id);
      await db.trackableDefinitions.delete(part.id);
      await addTombstone('trackableDefinitions', part.id, t?.name);
    }
  });
  notifyMutation();
}

/** What a merge did, for Undo (`undoMergeTrackable`). */
export interface MergeResult {
  sourceId: string;
  targetId: string;
  entryIds: string[];
  /** The target's fields before the merge. */
  targetFieldIds: string[];
}

/**
 * Merges a trackable into another (3.72): every entry moves to the target,
 * which gains the fields it didn't have; the emptied source is archived, not
 * deleted.
 */
export async function mergeTrackable(sourceId: string, targetId: string): Promise<MergeResult> {
  const result = await db.transaction('rw', db.trackableDefinitions, db.trackableEntries, async () => {
    const [source, target] = await db.trackableDefinitions.bulkGet([sourceId, targetId]);
    if (!source || !target || sourceId === targetId) throw new Error('Pick another trackable to merge into.');
    if (source.displayMode === 'ages' || target.displayMode === 'ages') throw new Error('Dates trackables cannot be merged.');
    const entryIds = (await db.trackableEntries.where('trackableId').equals(sourceId).primaryKeys()) as string[];
    const now = Date.now();
    await moveEntries(entryIds, targetId, now);
    await db.trackableDefinitions.update(targetId, { fieldIds: mergedFieldIds(target.fieldIds, source.fieldIds), updatedAt: now });
    await db.trackableDefinitions.update(sourceId, { archived: true, updatedAt: now });
    return { sourceId, targetId, entryIds, targetFieldIds: [...target.fieldIds] };
  });
  notifyMutation();
  return result;
}

/** Puts a merge back: the entries return and the source is unarchived; the target keeps entries logged since. */
export async function undoMergeTrackable(merge: MergeResult): Promise<void> {
  await db.transaction('rw', db.trackableDefinitions, db.trackableEntries, async () => {
    const now = Date.now();
    await moveEntries(merge.entryIds, merge.sourceId, now);
    await db.trackableDefinitions.update(merge.targetId, { fieldIds: merge.targetFieldIds, updatedAt: now });
    await db.trackableDefinitions.update(merge.sourceId, { archived: undefined, updatedAt: now });
  });
  notifyMutation();
}

async function moveEntries(entryIds: readonly string[], trackableId: string, now: number): Promise<void> {
  for (const entryId of entryIds) await db.trackableEntries.update(entryId, { trackableId, updatedAt: now });
}

export async function deleteTrackable(id: string): Promise<void> {
  const trackable = await db.trackableDefinitions.get(id);
  const entries = await db.trackableEntries.where('trackableId').equals(id).toArray();
  await db.trackableEntries.where('trackableId').equals(id).delete();
  for (const entry of entries) await addTombstone('trackableEntries', entry.id, trackable?.name);
  await db.trackableDefinitions.delete(id);
  await addTombstone('trackableDefinitions', id, trackable?.name);
  notifyMutation();
}

// ---------------------------------------------------------------------------
// Trackable entries
// ---------------------------------------------------------------------------

export async function addTrackableEntry(
  input: Omit<TrackableEntry, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<TrackableEntry> {
  const now = Date.now();
  const entry: TrackableEntry = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  await db.trackableEntries.add(entry);
  notifyMutation();
  return entry;
}

/** Adds many entries in one write and one change notice (an import, the holiday pack), instead of one sync check each. */
export async function addTrackableEntries(inputs: Array<Omit<TrackableEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TrackableEntry[]> {
  if (inputs.length === 0) return [];
  const now = Date.now();
  const entries = inputs.map((input) => ({ ...input, id: uuid(), createdAt: now, updatedAt: now }) as TrackableEntry);
  await db.trackableEntries.bulkAdd(entries);
  notifyMutation();
  return entries;
}

export async function updateTrackableEntry(id: string, patch: Partial<TrackableEntry>): Promise<void> {
  await db.trackableEntries.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

export async function deleteTrackableEntry(id: string): Promise<void> {
  const entry = await db.trackableEntries.get(id);
  const trackable = entry ? await db.trackableDefinitions.get(entry.trackableId) : undefined;
  await db.trackableEntries.delete(id);
  await addTombstone('trackableEntries', id, trackable?.name);
  notifyMutation();
}
