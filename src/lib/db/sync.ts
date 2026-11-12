// What a sync sends and receives on this device (ARCHITECTURE.md 3.6).

import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry, TaskProject, Task, TaskCompletion, SettingsRecord, SyncRecordType, SyncTombstone, SyncRetryKey, SyncMeta } from './types';
import { db, uuid, notifyMutation } from './schema';
import { getSettings } from './records';
import { removeTasks } from './tasks';

// ---------------------------------------------------------------------------
// Sync support helpers
// ---------------------------------------------------------------------------

export interface SyncableRecords {
  fasts: FastRecord[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  taskProjects: TaskProject[];
  tasks: Task[];
  taskCompletions: TaskCompletion[];
  settings: SettingsRecord;
}

/** Full local snapshot of every syncable table: exports, imports, and a sync's full send. */
export async function getAllSyncableRecords(): Promise<SyncableRecords> {
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, taskProjects, tasks, taskCompletions, settings] = await Promise.all([
    db.fasts.toArray(),
    db.fieldDefinitions.toArray(),
    db.trackableDefinitions.toArray(),
    db.trackableEntries.toArray(),
    db.taskProjects.toArray(),
    db.tasks.toArray(),
    db.taskCompletions.toArray(),
    getSettings(),
  ]);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, taskProjects, tasks, taskCompletions, settings };
}

/** What a synced table offers through its indexes (v8), whatever its record type. */
interface IndexedTable {
  where(index: string): {
    aboveOrEqual(value: number): { toArray(): Promise<unknown[]>; count(): Promise<number> };
    anyOf(keys: string[]): { toArray(): Promise<unknown[]> };
  };
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
  const again = (type: SyncRecordType) => retry.filter((r) => r.recordType === type).map((r) => r.uuid);
  // Through the updatedAt index (v8), then the refused ones by their keys.
  async function changedIn<T>(table: IndexedTable, type: SyncRecordType, key: 'id' | 'uuid'): Promise<T[]> {
    const recent = (await table.where('updatedAt').aboveOrEqual(since).toArray()) as T[];
    const keys = again(type);
    if (keys.length === 0) return recent;
    const seen = new Set(recent.map((r) => (r as Record<string, unknown>)[key]));
    const retried = (await table.where(key).anyOf(keys).toArray()) as T[];
    return [...recent, ...retried.filter((r) => !seen.has((r as Record<string, unknown>)[key]))];
  }
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, taskProjects, tasks, taskCompletions, settings] = await Promise.all([
    changedIn<FastRecord>(db.fasts, 'fasts', 'uuid'),
    changedIn<FieldDefinition>(db.fieldDefinitions, 'fieldDefinitions', 'id'),
    changedIn<TrackableDefinition>(db.trackableDefinitions, 'trackableDefinitions', 'id'),
    changedIn<TrackableEntry>(db.trackableEntries, 'trackableEntries', 'id'),
    changedIn<TaskProject>(db.taskProjects, 'taskProjects', 'id'),
    changedIn<Task>(db.tasks, 'tasks', 'id'),
    changedIn<TaskCompletion>(db.taskCompletions, 'taskCompletions', 'id'),
    getSettings(),
  ]);
  const settingsChanged = settings.updatedAt >= since || retry.some((r) => r.recordType === 'settings' && r.uuid === settings.id);
  return {
    fasts,
    fieldDefinitions,
    trackableDefinitions,
    trackableEntries,
    taskProjects,
    tasks,
    taskCompletions,
    settings: settingsChanged ? settings : null,
  };
}

/** How many local changes the server hasn't got yet: what the next sync would send, deletes included. */
export async function countWaitingChanges(): Promise<number> {
  const meta = await getSyncMeta();
  const tombstones = await db.syncTombstones.count();
  if (meta.sentThrough == null) return tombstones; // never synced: nothing to compare against
  const since = meta.sentThrough;
  // Counted through the updatedAt index (v8): no record is read.
  const tables: IndexedTable[] = [db.fasts, db.fieldDefinitions, db.trackableDefinitions, db.trackableEntries, db.taskProjects, db.tasks, db.taskCompletions];
  const counts = await Promise.all(tables.map((t) => t.where('updatedAt').aboveOrEqual(since).count()));
  const settings = await getSettings();
  return tombstones + counts.reduce((a, b) => a + b, 0) + (settings.updatedAt >= since ? 1 : 0);
}

/** Live records per type on this device, for Check sync and the erase confirmation. */
export async function countLocalRecords(): Promise<Record<SyncRecordType, number>> {
  const [fasts, fieldDefinitions, trackableDefinitions, trackableEntries, taskProjects, tasks, taskCompletions] = await Promise.all([
    db.fasts.count(),
    db.fieldDefinitions.count(),
    db.trackableDefinitions.count(),
    db.trackableEntries.count(),
    db.taskProjects.count(),
    db.tasks.count(),
    db.taskCompletions.count(),
  ]);
  return { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, taskProjects, tasks, taskCompletions };
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

/**
 * Gets this device ready to reload from the server after it was away so long
 * that deletes it missed are no longer kept there (3.70). Its own changes the
 * server hasn't had yet (and its pending deletes) stay; everything else is
 * cleared, to come back from the server on the next sync, which starts from
 * the beginning. Returns how many changes it kept.
 */
export async function keepUnsyncedAndReset(): Promise<number> {
  const meta = await getSyncMeta();
  const keep = meta.sentThrough != null ? await getChangedSyncableRecords(meta.sentThrough, meta.retry) : null;
  await db.transaction('rw', [db.fasts, db.fieldDefinitions, db.trackableDefinitions, db.trackableEntries, db.taskProjects, db.tasks, db.taskCompletions], async () => {
    await Promise.all([db.fasts, db.fieldDefinitions, db.trackableDefinitions, db.trackableEntries, db.taskProjects, db.tasks, db.taskCompletions].map((t) => t.clear()));
    if (!keep) return;
    await db.fasts.bulkAdd(keep.fasts.map(({ id: _id, ...f }) => f));
    await db.fieldDefinitions.bulkAdd(keep.fieldDefinitions);
    await db.trackableDefinitions.bulkAdd(keep.trackableDefinitions);
    await db.trackableEntries.bulkAdd(keep.trackableEntries);
    await db.taskProjects.bulkAdd(keep.taskProjects);
    await db.tasks.bulkAdd(keep.tasks);
    await db.taskCompletions.bulkAdd(keep.taskCompletions);
  });
  // Pull everything; send everything left (only what was kept).
  await setSyncMeta({ cursor: 0, sentThrough: undefined, lastFullSendAt: undefined, retry: [] });
  notifyMutation();
  if (!keep) return 0;
  return (
    keep.fasts.length +
    keep.fieldDefinitions.length +
    keep.trackableDefinitions.length +
    keep.trackableEntries.length +
    keep.taskProjects.length +
    keep.tasks.length +
    keep.taskCompletions.length
  );
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
  /** Missing from a server (or an export file) older than tasks. */
  taskProjects?: Synced<TaskProject>[];
  tasks?: Synced<Task>[];
  taskCompletions?: Synced<TaskCompletion>[];
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
    [db.fasts, db.fieldDefinitions, db.trackableDefinitions, db.trackableEntries, db.settings, db.taskProjects, db.tasks, db.taskCompletions],
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
      // Tasks: a delete from another device takes what hangs off it here too
      // (that device sent deletes for those as well; this covers any order).
      for (const remote of changes.taskProjects ?? []) {
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await removeTasks(await db.tasks.where('projectId').equals(remote.id).primaryKeys(), false);
          await db.taskProjects.delete(remote.id);
          continue;
        }
        await db.taskProjects.put(rest);
      }
      for (const remote of changes.tasks ?? []) {
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await removeTasks([remote.id], false);
          continue;
        }
        await db.tasks.put(rest);
      }
      for (const remote of changes.taskCompletions ?? []) {
        const { deletedAt, updatedBy: _by, ...rest } = remote;
        if (deletedAt) {
          await db.taskCompletions.delete(remote.id);
          continue;
        }
        await db.taskCompletions.put(rest);
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
