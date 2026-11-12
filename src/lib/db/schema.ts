// The IndexedDB schema and its upgrades, the shared `db`, and what every
// write here does when it's done: tell the sync store (onLocalMutation).

import Dexie, { type EntityTable } from 'dexie';
import { startOfDay } from '../utils/time';
import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry, TaskProject, Task, TaskCompletion, SettingsRecord, SyncRecordType, SyncTombstone, SyncMeta, SyncLogRow } from './types';

export function uuid(): string {
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
  taskProjects!: EntityTable<TaskProject, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  taskCompletions!: EntityTable<TaskCompletion, 'id'>;

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
    // v7: tasks (ARCHITECTURE.md 3.59). The pull cursor goes back to 0 once:
    // a device on an older version moved its cursor past any task rows another
    // device had already synced, without storing them, so the first sync on
    // this version receives everything again. Nothing local is deleted.
    this.version(7)
      .stores({
        fasts: '++id, startTime, endTime, startDay, uuid',
        settings: 'id',
        fieldDefinitions: 'id, name',
        trackableDefinitions: 'id, name',
        trackableEntries: 'id, trackableId, timestamp',
        syncTombstones: '++id, recordType, uuid, deletedAt',
        syncMeta: 'id',
        syncLog: '++id, completedAt',
        taskProjects: 'id',
        tasks: 'id, projectId, parentId',
        taskCompletions: 'id, taskId',
      })
      .upgrade(async (tx) => {
        await tx.table<SyncMeta>('syncMeta').update('sync', { cursor: 0 });
      });
    // v8: an `updatedAt` index on every synced table, so a sync finds what
    // changed since the last one without reading every record (ARCHITECTURE.md
    // 3.68). Dexie builds the indexes; no data changes.
    this.version(8).stores({
      fasts: '++id, startTime, endTime, startDay, uuid, updatedAt',
      settings: 'id',
      fieldDefinitions: 'id, name, updatedAt',
      trackableDefinitions: 'id, name, updatedAt',
      trackableEntries: 'id, trackableId, timestamp, updatedAt',
      syncTombstones: '++id, recordType, uuid, deletedAt',
      syncMeta: 'id',
      syncLog: '++id, completedAt',
      taskProjects: 'id, updatedAt',
      tasks: 'id, projectId, parentId, updatedAt',
      taskCompletions: 'id, taskId, updatedAt',
    });
  }
}

/**
 * Seeded field names (lowercased) that represent cumulative daily totals --
 * used only to backfill `aggregation: 'sum'` for pre-existing installs in
 * the v5 upgrade above, and to set it on freshly-seeded fields.
 */
export const SUM_AGGREGATION_FIELD_NAMES = new Set([
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

export function notifyMutation(): void {
  for (const listener of mutationListeners) listener();
}

export const db = new ZachTrackDB();

export async function addTombstone(recordType: SyncRecordType, recordUuid: string, label?: string): Promise<void> {
  await db.syncTombstones.add({ recordType, uuid: recordUuid, deletedAt: Date.now(), ...(label ? { label } : {}) });
}
