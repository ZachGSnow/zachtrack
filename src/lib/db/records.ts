// Settings, fasts, fields, trackables and their entries.

import { startOfDay } from '../utils/time';
import { BODY_FIELD_ROLES, BODY_FIELD_SETTING, resolveBodyField } from '../utils/health';
import { type FastRecord, type FieldDefinition, type TrackableDefinition, type TrackableEntry, type SettingsRecord, DEFAULT_SETTINGS, DuplicateStartDayError } from './types';
import { db, uuid, notifyMutation, addTombstone } from './schema';

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
