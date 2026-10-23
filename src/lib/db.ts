import Dexie, { type EntityTable } from 'dexie';
import { startOfDay } from './utils/time';
import type { CustomFastPreset } from './data/presets';
import type { SyncHistoryEntry } from './utils/syncHistory';
import { BODY_FIELD_ROLES, BODY_FIELD_SETTING, resolveBodyField, type BodyFatSex } from './utils/health';

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

/** dailyTotal: the first field's total per day; perDay: entries per day; perWeek: days logged per week; everyDays: due every N days; avoid: time since is the streak. */
export type TrackableGoalType = 'dailyTotal' | 'perDay' | 'perWeek' | 'everyDays' | 'avoid';

/** How a trackable is summarised; 'occurrences' (or unset) = automatic from its fields. See utils/trackableKinds.ts. */
export type TrackableDisplayMode = 'occurrences' | 'ages' | 'event' | 'measurement' | 'daily' | 'checkin';

/** A user-defined "thing to track" -- an occurrence, optionally carrying values for its attached fields. */
export interface TrackableDefinition {
  id: string; // uuid
  name: string;
  icon: string; // emoji
  color: string; // hex
  /** Ordered list of FieldDefinition ids attached to this trackable. */
  fieldIds: string[];
  /**
   * Which kind it is shown as (utils/trackableKinds.ts). Omitted or
   * 'occurrences' = automatic from its fields. 'ages' is for tracking people
   * by birthdate (entry.timestamp = birthdate, entry.note = name).
   */
  displayMode?: TrackableDisplayMode;
  /** Optional goal (utils/trackableGoals.ts); `goalValue` is its number (amount, times or days). */
  goalType?: TrackableGoalType;
  goalValue?: number;
  /** Shown above the others on the Trackables list, whatever the sort. */
  pinned?: boolean;
  /** Hidden from the list (under Archived) but kept with all its entries. */
  archived?: boolean;
  /** Position in the list's "My order" sort; unset sorts by name after the ordered ones. */
  sortOrder?: number;
  /** Days a daily goal applies, 0 = Monday ... 6 = Sunday; unset = every day. Other days don't break its streak. */
  scheduleDays?: number[];
  /** Single days skipped ("YYYY-MM-DD", local): they neither count nor break a streak. */
  skipDays?: string[];
  /** Paused through this day (local start-of-day): treated like skipped days, and nothing is due. */
  pausedUntil?: number;
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
  /** Unused since v1.11.0 (in-app milestones replaced notifications); kept so older devices still sync. */
  notificationsEnabled: boolean;
  /** Inches; used to compute BMI from the weight field's logged values. */
  heightInches?: number;
  /** Pounds; drawn as a dashed reference line on the weight field's charts. */
  goalWeightLb?: number;
  /** The number field that holds body weight (BMI, goal line). Unset = the field named "Weight"; see resolveBodyField. */
  weightFieldId?: string;
  /** Fields the Navy body-fat estimate reads. Unset = the field named "Waist" / "Neck" / "Hip". */
  waistFieldId?: string;
  neckFieldId?: string;
  hipFieldId?: string;
  /** Picks the Navy formula; no body-fat estimate until it's set. */
  bodyFatSex?: BodyFatSex;
  /** Daily planned fast start, "HH:MM" local time (utils/fastingSchedule.ts). Unset = no schedule. */
  fastScheduleTime?: string;
  /** Fast lengths you saved yourself, shown with the built-in methods (data/presets.ts). */
  customFastPresets?: CustomFastPreset[];
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
  /** What was deleted, for this device's sync history (e.g. the trackable's name). Never sent. */
  label?: string;
}

/** A record the server refused last time, sent again with every sync until it's accepted or gone. */
export interface SyncRetryKey {
  recordType: SyncRecordType | 'settings';
  uuid: string;
}

/** Singleton row (id fixed to 'sync') tracking this device's sync progress. */
export interface SyncMeta {
  id: 'sync';
  /** Last server-assigned `serverSeq` this device has seen; the pull cursor. */
  cursor: number;
  lastSyncedAt?: number;
  /**
   * Local time the last successful sync started. Records with `updatedAt` at or
   * after it haven't reached the server yet, so the next sync sends only those.
   * Unset until the first successful sync, which sends everything.
   */
  sentThrough?: number;
  /** When this device last sent its whole dataset; a full send runs once a day as a safety net. */
  lastFullSendAt?: number;
  /** When a full send was asked for (an import, whose records keep their own older `updatedAt`, or Full resync); cleared by the next full send that starts after it. */
  fullSendRequestedAt?: number;
  /** Records the server refused last time; see SyncRetryKey. */
  retry?: SyncRetryKey[];
  /** This device's id in the server's device list; made on first use, new again after an erase. */
  deviceId?: string;
  /** What this device is called in the device list and activity, e.g. "Phone". */
  deviceName?: string;
  /** Set by Sign out, so the pill says "Signed out" rather than "Login expired"; cleared by the next good sync. */
  signedOutAt?: number;
}

/** A row of this device's own sync history (see utils/syncHistory.ts), kept 30 days. */
export type SyncLogRow = SyncHistoryEntry & { id?: number };

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
  syncLog!: EntityTable<SyncLogRow, 'id'>;

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
    // v6: this device's sync history moves from localStorage (last 5) to its
    // own table (30 days); stores/sync.svelte.ts copies the old entries over.
    this.version(6).stores({
      fasts: '++id, startTime, endTime, startDay, uuid',
      settings: 'id',
      fieldDefinitions: 'id, name',
      trackableDefinitions: 'id, name',
      trackableEntries: 'id, trackableId, timestamp',
      syncTombstones: '++id, recordType, uuid, deletedAt',
      syncMeta: 'id',
      syncLog: '++id, completedAt',
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

// ---------------------------------------------------------------------------
// Sync support helpers
// ---------------------------------------------------------------------------

async function addTombstone(recordType: SyncRecordType, recordUuid: string, label?: string): Promise<void> {
  await db.syncTombstones.add({ recordType, uuid: recordUuid, deletedAt: Date.now(), ...(label ? { label } : {}) });
}

export interface SyncableRecords {
  fasts: FastRecord[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  settings: SettingsRecord;
}

/** Full local snapshot of every syncable table: exports, imports, and a sync's full send. */
export async function getAllSyncableRecords(): Promise<SyncableRecords> {
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings] = await Promise.all([
    db.fasts.toArray(),
    db.fieldDefinitions.toArray(),
    db.trackableDefinitions.toArray(),
    db.trackableEntries.toArray(),
    getSettings(),
  ]);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings };
}

/**
 * The records a sync sends when it isn't a full send: everything changed at or
 * after `since` (SyncMeta.sentThrough), plus any the server refused last time.
 * `settings` is null when it hasn't changed.
 */
export async function getChangedSyncableRecords(
  since: number,
  retry: SyncRetryKey[] = [],
): Promise<Omit<SyncableRecords, 'settings'> & { settings: SettingsRecord | null }> {
  const again = new Set(retry.map((r) => `${r.recordType}:${r.uuid}`));
  const changed = (type: SyncRecordType, key: string, updatedAt: number) => updatedAt >= since || again.has(`${type}:${key}`);
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings] = await Promise.all([
    db.fasts.filter((f) => changed('fasts', f.uuid, f.updatedAt)).toArray(),
    db.fieldDefinitions.filter((f) => changed('fieldDefinitions', f.id, f.updatedAt)).toArray(),
    db.trackableDefinitions.filter((t) => changed('trackableDefinitions', t.id, t.updatedAt)).toArray(),
    db.trackableEntries.filter((e) => changed('trackableEntries', e.id, e.updatedAt)).toArray(),
    getSettings(),
  ]);
  const settingsChanged = settings.updatedAt >= since || again.has(`settings:${settings.id}`);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings: settingsChanged ? settings : null };
}

/** How many local changes the server hasn't got yet: what the next sync would send, deletes included. */
export async function countWaitingChanges(): Promise<number> {
  const meta = await getSyncMeta();
  const tombstones = await db.syncTombstones.count();
  if (meta.sentThrough == null) return tombstones; // never synced: nothing to compare against
  const changes = await getChangedSyncableRecords(meta.sentThrough);
  return (
    tombstones +
    changes.fasts.length +
    changes.fieldDefinitions.length +
    changes.trackableDefinitions.length +
    changes.trackableEntries.length +
    (changes.settings ? 1 : 0)
  );
}

/** Live records per type on this device, for Check sync and the erase confirmation. */
export async function countLocalRecords(): Promise<{ fasts: number; fieldDefinitions: number; trackableDefinitions: number; trackableEntries: number }> {
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries] = await Promise.all([
    db.fasts.count(),
    db.fieldDefinitions.count(),
    db.trackableDefinitions.count(),
    db.trackableEntries.count(),
  ]);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries };
}

/**
 * Deletes everything this app stores on this device: the whole IndexedDB
 * database (records, history, sync state and device id) and its localStorage
 * keys. The next start is a fresh install that waits for a sync before
 * creating anything (App.svelte).
 */
export async function eraseLocalData(): Promise<void> {
  db.close();
  await db.delete();
  if (typeof localStorage !== 'undefined') {
    for (const key of Object.keys(localStorage)) if (key.startsWith('zachtrack:')) localStorage.removeItem(key);
  }
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

/** A starting name for this device from its browser, until it's renamed on the Sync page. */
export function guessDeviceName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'Mac';
  if (/CrOS/.test(userAgent)) return 'Chromebook';
  if (/Linux/.test(userAgent)) return 'Linux PC';
  return 'This device';
}

/** This device's id and name, made the first time they're needed. */
export async function getDevice(): Promise<{ id: string; name: string }> {
  const meta = await getSyncMeta();
  if (meta.deviceId && meta.deviceName) return { id: meta.deviceId, name: meta.deviceName };
  const device = {
    id: meta.deviceId ?? uuid(),
    name: meta.deviceName ?? guessDeviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  };
  await setSyncMeta({ deviceId: device.id, deviceName: device.name });
  return device;
}

/**
 * A record as returned by the sync server: same shape as local, plus
 * `deletedAt` for tombstoned rows and `updatedBy`, the device id that last
 * changed it. Neither is stored locally.
 */
type Synced<T> = T & { deletedAt?: number | null; updatedBy?: string | null };

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
        const { deletedAt, updatedBy: _by, ...rest } = remote;
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
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await db.fieldDefinitions.delete(remote.id);
          continue;
        }
        await db.fieldDefinitions.put(rest);
      }
      for (const remote of changes.trackableDefinitions) {
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await db.trackableDefinitions.delete(remote.id);
          await db.trackableEntries.where('trackableId').equals(remote.id).delete();
          continue;
        }
        await db.trackableDefinitions.put(rest);
      }
      for (const remote of changes.trackableEntries) {
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await db.trackableEntries.delete(remote.id);
          continue;
        }
        await db.trackableEntries.put(rest);
      }
      if (changes.settings) {
        const { deletedAt, updatedBy: _by, ...rest } = changes.settings;
        if (!deletedAt) await db.settings.put(rest);
      }
    },
  );
}

/**
 * Writes the records of a confirmed import (see `planImport` in dataFile.ts,
 * which has already kept only new or newer records and never includes
 * deletes), then notifies listeners so the next sync sends them.
 */
export async function importRecords(changes: RemoteSyncChanges): Promise<void> {
  await applyRemoteChanges(changes);
  // Imported records keep their own updatedAt, usually older than the last
  // sync, so only a full send is sure to include them.
  await setSyncMeta({ fullSendRequestedAt: Date.now() });
  notifyMutation();
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
    { name: 'Neck', kind: 'number', unit: 'in' },
    { name: 'Hip', kind: 'number', unit: 'in' },
    { name: 'Chest', kind: 'number', unit: 'in' },
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

  const trackableSpecs: Array<{ name: string; icon: string; color: string; fields: string[]; displayMode?: TrackableDisplayMode }> = [
    { name: 'Body Measurements', icon: '\u2696\ufe0f', color: '#a855f7', fields: ['Weight', 'Waist', 'Neck', 'Hip', 'Chest'] },
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
    // Logged with a Flow rating, but the timing between cycles is what matters.
    { name: 'Menstrual Cycle', icon: '\ud83c\udf38', color: '#ec4899', fields: ['Flow'], displayMode: 'event' },
    { name: 'Male Health', icon: '\ud83d\udca7', color: '#38bdf8', fields: [] },
  ];

  for (const spec of trackableSpecs) {
    await createTrackable({
      name: spec.name,
      icon: spec.icon,
      color: spec.color,
      fieldIds: spec.fields.map(fid),
      ...(spec.displayMode ? { displayMode: spec.displayMode } : {}),
    });
  }
}
