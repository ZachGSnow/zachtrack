import Dexie, { type EntityTable } from 'dexie';
import { startOfDay } from './utils/time';

export interface FastRecord {
  id?: number;
  /** Stable id used for sync, independent of Dexie's local auto-increment `id`. */
  uuid: string;
  /** Epoch milliseconds. */
  startTime: number;
  /** Start-of-day (local midnight) epoch ms for `startTime`. Enforced unique at the app level. */
  startDay: number;
  /** Epoch milliseconds; null/undefined while the fast is still active. */
  endTime?: number;
  method: 'preset' | 'custom';
  presetId?: string;
  presetLabel?: string;
  targetHours?: number;
  moodRating?: number; // 1-5
  energyRating?: number; // 1-5
  hungerRating?: number; // 1-5
  /** Free-form context tags, e.g. "traveled", "stressful", "workout". */
  tags?: string[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type FieldKind = 'number' | 'rating' | 'boolean';

/**
 * How multiple same-day entries for a field should be combined for daily
 * charts/stats. 'sum' for cumulative metrics (e.g. Water, Calories),
 * 'average' for point-in-time readings taken more than once a day (e.g.
 * Blood Pressure), 'last' (default when unset) for "most recent reading
 * wins" (e.g. Weight). Only meaningful for 'number'/'rating' fields.
 */
export type FieldAggregation = 'sum' | 'average' | 'last';

/** A reusable, globally-defined metric (e.g. "Weight", "Pain") attachable to any Trackable. */
export interface FieldDefinition {
  id: string; // uuid
  name: string;
  kind: FieldKind;
  /** Only meaningful for 'number' fields, e.g. "lb", "oz", "kcal". */
  unit?: string;
  /** Only meaningful for 'rating' fields; defaults to 1-5 if unset. */
  ratingMin?: number;
  ratingMax?: number;
  /** Undefined behaves as 'last' (preserves pre-existing behavior). */
  aggregation?: FieldAggregation;
  createdAt: number;
  updatedAt: number;
}

export type TrackableDisplayMode = 'occurrences' | 'ages';

/** A user-defined "thing to track" -- an occurrence, optionally carrying values for its attached fields. */
export interface TrackableDefinition {
  id: string; // uuid
  name: string;
  icon: string; // emoji
  color: string; // hex
  /** Ordered list of FieldDefinition ids attached to this trackable. */
  fieldIds: string[];
  /**
   * How this trackable's entries should be displayed. Omitted/undefined
   * behaves as 'occurrences' (today's default: habit/event analytics --
   * streaks, intervals, heatmaps). 'ages' is for tracking people by
   * birthdate (entry.timestamp = birthdate, entry.note = name) with a
   * live age + upcoming-birthday countdown instead of occurrence stats.
   */
  displayMode?: TrackableDisplayMode;
  createdAt: number;
  updatedAt: number;
}

/** A single logged occurrence of a Trackable. */
export interface TrackableEntry {
  id: string; // uuid
  trackableId: string;
  timestamp: number;
  note?: string;
  tags?: string[];
  /** fieldId -> value, only for fields attached to this entry's trackable. */
  values?: Record<string, number | boolean>;
  createdAt: number;
  updatedAt: number;
}

export interface SettingsRecord {
  id: 'app-settings';
  defaultPresetId: string;
  notificationsEnabled: boolean;
  /** Inches; used to compute BMI from a "Weight" field's logged values. */
  heightInches?: number;
  /** Pounds; drawn as a dashed reference line on Weight charts. */
  goalWeightLb?: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Omit<SettingsRecord, 'updatedAt'> = {
  id: 'app-settings',
  defaultPresetId: '16:8',
  notificationsEnabled: false,
};

/** Record types that participate in Cloudflare sync (fasts keyed by `uuid`, others already uuid-keyed). */
export type SyncRecordType = 'fasts' | 'fieldDefinitions' | 'trackableDefinitions' | 'trackableEntries';

/** A local record of a hard delete, kept only until acknowledged by the sync server, so the delete can propagate to other devices. */
export interface SyncTombstone {
  id?: number;
  recordType: SyncRecordType;
  uuid: string;
  deletedAt: number;
}

/** Singleton row (id fixed to 'sync') tracking this device's sync progress. */
export interface SyncMeta {
  id: 'sync';
  /** Last server-assigned `serverSeq` this device has seen; the pull cursor. */
  cursor: number;
  lastSyncedAt?: number;
}

/** Thrown when a fast would be saved with a start date that's already taken by another fast. */
export class DuplicateStartDayError extends Error {
  constructor() {
    super('A fast already starts on that day. Edit that one instead, or pick a different date.');
    this.name = 'DuplicateStartDayError';
  }
}

function uuid(): string {
  return crypto.randomUUID();
}

export class ZachTrackDB extends Dexie {
  fasts!: EntityTable<FastRecord, 'id'>;
  settings!: EntityTable<SettingsRecord, 'id'>;
  fieldDefinitions!: EntityTable<FieldDefinition, 'id'>;
  trackableDefinitions!: EntityTable<TrackableDefinition, 'id'>;
  trackableEntries!: EntityTable<TrackableEntry, 'id'>;
  syncTombstones!: EntityTable<SyncTombstone, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'id'>;

  constructor() {
    super('snowfast');
    this.version(1).stores({
      fasts: '++id, startTime, endTime',
      measurements: '++id, timestamp',
      settings: 'id',
    });
    // v2: adds a non-unique `startDay` index so we can efficiently look up
    // "is there already a fast starting on this calendar day". This is
    // enforced at the application level (see getFastForDay/addFast/updateFast)
    // rather than as a hard unique DB constraint, so any pre-existing local
    // data with same-day fasts won't break the upgrade.
    this.version(2)
      .stores({
        fasts: '++id, startTime, endTime, startDay',
        measurements: '++id, timestamp',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table<FastRecord>('fasts')
          .toCollection()
          .modify((f) => {
            f.startDay = startOfDay(f.startTime);
          });
      });
    // v3: replaces the fixed `measurements` table with the generic Trackables
    // system (FieldDefinition + TrackableDefinition + TrackableEntry). Old
    // measurement data is intentionally dropped, not migrated.
    this.version(3).stores({
      fasts: '++id, startTime, endTime, startDay',
      settings: 'id',
      measurements: null,
      fieldDefinitions: 'id, name',
      trackableDefinitions: 'id, name',
      trackableEntries: 'id, trackableId, timestamp',
    });
    // v4: adds Cloudflare sync support. `fasts` gains a `uuid` (previously
    // only the local auto-increment `id` existed, which isn't safe to sync
    // across devices). `fieldDefinitions` and `settings` gain `updatedAt` so
    // last-write-wins conflict resolution has something to compare. Two new
    // tables: `syncTombstones` (short-lived record of local hard deletes,
    // pruned once acknowledged by the server) and `syncMeta` (this device's
    // pull cursor). Existing tables keep using hard deletes locally --
    // soft-delete/tombstone semantics are a sync-layer concern only, so nothing
    // about how the rest of the app reads these tables needs to change.
    this.version(4)
      .stores({
        fasts: '++id, startTime, endTime, startDay, uuid',
        settings: 'id',
        fieldDefinitions: 'id, name',
        trackableDefinitions: 'id, name',
        trackableEntries: 'id, trackableId, timestamp',
        syncTombstones: '++id, recordType, uuid, deletedAt',
        syncMeta: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table<FastRecord>('fasts')
          .toCollection()
          .modify((f) => {
            if (!f.uuid) f.uuid = uuid();
          });
        await tx
          .table<FieldDefinition>('fieldDefinitions')
          .toCollection()
          .modify((f) => {
            if (f.updatedAt == null) f.updatedAt = f.createdAt;
          });
        const settingsRow = await tx.table<SettingsRecord>('settings').get('app-settings');
        if (settingsRow && settingsRow.updatedAt == null) {
          await tx.table('settings').update('app-settings', { updatedAt: Date.now() });
        }
      });
    // v5: backfills `aggregation` on known cumulative fields so multi-entry
    // days (e.g. logging Water four times) sum correctly in charts/stats
    // instead of the previous behavior, where each same-day entry silently
    // overwrote the last one. Every other field is left undefined, which
    // still behaves as 'last' (unchanged for anything not in this list,
    // including user-created custom fields).
    this.version(5)
      .stores({
        fasts: '++id, startTime, endTime, startDay, uuid',
        settings: 'id',
        fieldDefinitions: 'id, name',
        trackableDefinitions: 'id, name',
        trackableEntries: 'id, trackableId, timestamp',
        syncTombstones: '++id, recordType, uuid, deletedAt',
        syncMeta: 'id',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        await tx
          .table<FieldDefinition>('fieldDefinitions')
          .toCollection()
          .modify((f) => {
            if (f.aggregation == null && SUM_AGGREGATION_FIELD_NAMES.has(f.name.trim().toLowerCase())) {
              f.aggregation = 'sum';
              f.updatedAt = now;
            }
          });
      });
  }
}

/**
 * Seeded field names (lowercased) that represent cumulative daily totals --
 * used only to backfill `aggregation: 'sum'` for pre-existing installs in
 * the v5 upgrade above, and to set it on freshly-seeded fields.
 */
const SUM_AGGREGATION_FIELD_NAMES = new Set([
  'calories',
  'protein',
  'carbs',
  'fat',
  'caffeine',
  'alcohol',
  'water',
  'sleep hours',
  'duration',
  'calories burned',
  'steps',
]);

// ---------------------------------------------------------------------------
// Local mutation notifications (sync trigger hook)
// ---------------------------------------------------------------------------
//
// Plain Dexie 4 has no built-in `db.on('changes', ...)` event -- that only
// exists via the separate `dexie-observable` addon, which isn't installed
// and has real compatibility risk with Dexie 4. Since every local mutation
// already funnels through this file's exported functions, we notify
// listeners directly at the end of each one instead. The sync store
// subscribes via `onLocalMutation` to schedule a debounced sync.

type MutationListener = () => void;
const mutationListeners = new Set<MutationListener>();

/** Subscribe to local data mutations (fasts, trackables, entries, fields, settings). Returns an unsubscribe function. */
export function onLocalMutation(listener: MutationListener): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyMutation(): void {
  for (const listener of mutationListeners) listener();
}

export const db = new ZachTrackDB();

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
  if (existing?.uuid) await addTombstone('fasts', existing.uuid);
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
  await db.fieldDefinitions.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

export async function deleteFieldDefinition(id: string): Promise<void> {
  await db.fieldDefinitions.delete(id);
  await addTombstone('fieldDefinitions', id);
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
  const entries = await db.trackableEntries.where('trackableId').equals(id).toArray();
  await db.trackableEntries.where('trackableId').equals(id).delete();
  for (const entry of entries) await addTombstone('trackableEntries', entry.id);
  await db.trackableDefinitions.delete(id);
  await addTombstone('trackableDefinitions', id);
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

export async function updateTrackableEntry(id: string, patch: Partial<TrackableEntry>): Promise<void> {
  await db.trackableEntries.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

export async function deleteTrackableEntry(id: string): Promise<void> {
  await db.trackableEntries.delete(id);
  await addTombstone('trackableEntries', id);
  notifyMutation();
}

// ---------------------------------------------------------------------------
// Sync support helpers
// ---------------------------------------------------------------------------

async function addTombstone(recordType: SyncRecordType, recordUuid: string): Promise<void> {
  await db.syncTombstones.add({ recordType, uuid: recordUuid, deletedAt: Date.now() });
}

/** Full local snapshot of every syncable table, sent to the server on each sync (cheap at this app's scale; server dedupes via `updatedAt`). */
export async function getAllSyncableRecords(): Promise<{
  fasts: FastRecord[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  settings: SettingsRecord;
}> {
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings] = await Promise.all([
    db.fasts.toArray(),
    db.fieldDefinitions.toArray(),
    db.trackableDefinitions.toArray(),
    db.trackableEntries.toArray(),
    getSettings(),
  ]);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings };
}

/** All tombstones not yet acknowledged by the sync server. */
export async function getPendingTombstones(): Promise<SyncTombstone[]> {
  return db.syncTombstones.toArray();
}

/** Removes tombstones once the server has confirmed the corresponding deletes are recorded. */
export async function prunePendingTombstones(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.syncTombstones.bulkDelete(ids);
}

export async function getSyncMeta(): Promise<SyncMeta> {
  const existing = await db.syncMeta.get('sync');
  if (existing) return existing;
  const fresh: SyncMeta = { id: 'sync', cursor: 0 };
  await db.syncMeta.put(fresh);
  return fresh;
}

export async function setSyncMeta(patch: Partial<Omit<SyncMeta, 'id'>>): Promise<void> {
  const current = await getSyncMeta();
  await db.syncMeta.put({ ...current, ...patch });
}

/** A record as returned by the sync server: same shape as local, plus `deletedAt` for tombstoned rows. */
type Synced<T> = T & { deletedAt?: number | null };

export interface RemoteSyncChanges {
  fasts: Synced<FastRecord>[];
  fieldDefinitions: Synced<FieldDefinition>[];
  trackableDefinitions: Synced<TrackableDefinition>[];
  trackableEntries: Synced<TrackableEntry>[];
  settings: Synced<SettingsRecord> | null;
}

/**
 * Applies records/deletes pulled from the sync server into local Dexie
 * tables. The server has already resolved last-write-wins conflicts, so
 * every row here is simply applied as the new local truth. Rows with
 * `deletedAt` set are converted to real local hard deletes -- no tombstone
 * is written back for these, since they originated from a remote fact
 * rather than a local user action (that would just ping-pong the delete
 * back and forth forever).
 */
export async function applyRemoteChanges(changes: RemoteSyncChanges): Promise<void> {
  await db.transaction(
    'rw',
    [db.fasts, db.fieldDefinitions, db.trackableDefinitions, db.trackableEntries, db.settings],
    async () => {
      for (const remote of changes.fasts) {
        const { deletedAt, ...rest } = remote;
        const local = await db.fasts.where('uuid').equals(remote.uuid).first();
        if (deletedAt) {
          if (local?.id != null) await db.fasts.delete(local.id);
          continue;
        }
        if (local?.id != null) {
          await db.fasts.update(local.id, rest);
        } else {
          await db.fasts.add(rest);
        }
      }
      for (const remote of changes.fieldDefinitions) {
        const { deletedAt, ...rest } = remote;
        if (deletedAt) {
          await db.fieldDefinitions.delete(remote.id);
          continue;
        }
        await db.fieldDefinitions.put(rest);
      }
      for (const remote of changes.trackableDefinitions) {
        const { deletedAt, ...rest } = remote;
        if (deletedAt) {
          await db.trackableDefinitions.delete(remote.id);
          await db.trackableEntries.where('trackableId').equals(remote.id).delete();
          continue;
        }
        await db.trackableDefinitions.put(rest);
      }
      for (const remote of changes.trackableEntries) {
        const { deletedAt, ...rest } = remote;
        if (deletedAt) {
          await db.trackableEntries.delete(remote.id);
          continue;
        }
        await db.trackableEntries.put(rest);
      }
      if (changes.settings) {
        const { deletedAt, ...rest } = changes.settings;
        if (!deletedAt) await db.settings.put(rest);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Default seed data (first run only)
// ---------------------------------------------------------------------------

export async function seedDefaultTrackablesIfEmpty(): Promise<void> {
  const existingCount = await db.trackableDefinitions.count();
  if (existingCount > 0) return;

  const fieldSpecs: Array<Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt'>> = [
    { name: 'Weight', kind: 'number', unit: 'lb' },
    { name: 'Waist', kind: 'number', unit: 'in' },
    { name: 'Chest', kind: 'number', unit: 'in' },
    { name: 'Hip', kind: 'number', unit: 'in' },
    { name: 'Body Fat %', kind: 'number', unit: '%' },
    { name: 'Systolic BP', kind: 'number' },
    { name: 'Diastolic BP', kind: 'number' },
    { name: 'Temperature', kind: 'number', unit: '\u00b0F' },
    { name: 'Calories', kind: 'number', unit: 'kcal', aggregation: 'sum' },
    { name: 'Protein', kind: 'number', unit: 'g', aggregation: 'sum' },
    { name: 'Carbs', kind: 'number', unit: 'g', aggregation: 'sum' },
    { name: 'Fat', kind: 'number', unit: 'g', aggregation: 'sum' },
    { name: 'Caffeine', kind: 'number', unit: 'mg', aggregation: 'sum' },
    { name: 'Alcohol', kind: 'number', unit: 'drinks', aggregation: 'sum' },
    { name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum' },
    { name: 'Supplements Taken', kind: 'boolean' },
    { name: 'Sleep Hours', kind: 'number', unit: 'hrs', aggregation: 'sum' },
    { name: 'Sleep Quality', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Overall Mood', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Stress', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Focus', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Sickness', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Pain', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Bowel Movement', kind: 'rating', ratingMin: 1, ratingMax: 7 },
    { name: 'Duration', kind: 'number', unit: 'min', aggregation: 'sum' },
    { name: 'Exertion', kind: 'rating', ratingMin: 1, ratingMax: 5 },
    { name: 'Calories Burned', kind: 'number', unit: 'kcal', aggregation: 'sum' },
    { name: 'Steps', kind: 'number', aggregation: 'sum' },
    { name: 'Flow', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  ];

  const fieldByName = new Map<string, FieldDefinition>();
  for (const spec of fieldSpecs) {
    fieldByName.set(spec.name, await createFieldDefinition(spec));
  }
  const fid = (name: string) => fieldByName.get(name)!.id;

  const trackableSpecs: Array<{ name: string; icon: string; color: string; fields: string[] }> = [
    { name: 'Body Measurements', icon: '\u2696\ufe0f', color: '#a855f7', fields: ['Weight', 'Waist', 'Chest', 'Hip', 'Body Fat %'] },
    { name: 'Vitals', icon: '\u2764\ufe0f', color: '#ef4444', fields: ['Systolic BP', 'Diastolic BP', 'Temperature'] },
    {
      name: 'Nutrition',
      icon: '\ud83c\udf7d\ufe0f',
      color: '#f97316',
      fields: ['Calories', 'Protein', 'Carbs', 'Fat', 'Caffeine', 'Alcohol', 'Water', 'Supplements Taken'],
    },
    { name: 'Sleep', icon: '\ud83d\ude34', color: '#818cf8', fields: ['Sleep Hours', 'Sleep Quality'] },
    {
      name: 'Wellness Check-in',
      icon: '\ud83d\ude42',
      color: '#eab308',
      fields: ['Overall Mood', 'Stress', 'Focus', 'Sickness', 'Pain', 'Bowel Movement'],
    },
    { name: 'Activity', icon: '\ud83c\udfc3', color: '#22d3ee', fields: ['Duration', 'Exertion', 'Calories Burned', 'Steps'] },
    { name: 'Menstrual Cycle', icon: '\ud83c\udf38', color: '#ec4899', fields: ['Flow'] },
    { name: 'Male Health', icon: '\ud83d\udca7', color: '#38bdf8', fields: [] },
  ];

  for (const spec of trackableSpecs) {
    await createTrackable({
      name: spec.name,
      icon: spec.icon,
      color: spec.color,
      fieldIds: spec.fields.map(fid),
    });
  }
}
