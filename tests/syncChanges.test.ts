import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addTrackableEntry,
  countLocalRecords,
  countWaitingChanges,
  createTrackable,
  db,
  deleteTrackableEntry,
  eraseLocalData,
  getChangedSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  importRecords,
  keepUnsyncedAndReset,
  setSyncMeta,
  updateSettings,
} from '../src/lib/db';

// What a sync sends when it isn't a full send: only what changed since the
// last good sync started, plus records the server refused last time.

afterAll(() => db.close());

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const wait = () => new Promise((r) => setTimeout(r, 5));

describe('changed records', () => {
  it('sends only records changed at or after the last sync, and settings only when changed', async () => {
    const trackable = await createTrackable({ name: 'Water', icon: 'x', color: '#000000', fieldIds: [] });
    const old = await addTrackableEntry({ trackableId: trackable.id, timestamp: 1 });
    await wait();
    const since = Date.now();
    await wait();
    const fresh = await addTrackableEntry({ trackableId: trackable.id, timestamp: 2 });

    let changes = await getChangedSyncableRecords(since);
    expect(changes.trackableEntries.map((e) => e.id)).toEqual([fresh.id]);
    expect(changes.trackableDefinitions).toEqual([]);
    expect(changes.settings).toBeNull();

    await updateSettings({ heightInches: 70 });
    changes = await getChangedSyncableRecords(since, [{ recordType: 'trackableEntries', uuid: old.id }]);
    expect(changes.trackableEntries.map((e) => e.id).sort()).toEqual([fresh.id, old.id].sort());
    expect(changes.settings).toMatchObject({ heightInches: 70 });
  });

  it('counts waiting changes, deletes included, once the device has synced', async () => {
    const trackable = await createTrackable({ name: 'Water', icon: 'x', color: '#000000', fieldIds: [] });
    const entry = await addTrackableEntry({ trackableId: trackable.id, timestamp: 1 });
    expect(await countWaitingChanges()).toBe(0); // never synced

    await wait();
    await setSyncMeta({ sentThrough: Date.now() });
    await wait();
    await addTrackableEntry({ trackableId: trackable.id, timestamp: 2 });
    await deleteTrackableEntry(entry.id);
    expect(await countWaitingChanges()).toBe(2);
  });

  it('names what a delete removed, for the history, without sending the name', async () => {
    const trackable = await createTrackable({ name: 'Water', icon: 'x', color: '#000000', fieldIds: [] });
    const entry = await addTrackableEntry({ trackableId: trackable.id, timestamp: 1 });
    await deleteTrackableEntry(entry.id);
    expect(await getPendingTombstones()).toEqual([expect.objectContaining({ recordType: 'trackableEntries', uuid: entry.id, label: 'Water' })]);
  });

  it('asks for a full send after an import, since imported records keep their older updatedAt', async () => {
    const before = Date.now();
    await importRecords({ fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null });
    expect((await getSyncMeta()).fullSendRequestedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('reloading after being away too long (3.70)', () => {
  it('keeps the changes the server has not had, clears the rest and starts the next sync over', async () => {
    const trackable = await createTrackable({ name: 'Water', icon: 'x', color: '#000000', fieldIds: [] });
    await addTrackableEntry({ trackableId: trackable.id, timestamp: 1 });
    await wait();
    await setSyncMeta({ sentThrough: Date.now(), cursor: 42, lastFullSendAt: Date.now() });
    await wait();
    const unsent = await addTrackableEntry({ trackableId: trackable.id, timestamp: 2 });

    expect(await keepUnsyncedAndReset()).toBe(1);
    expect((await db.trackableEntries.toArray()).map((e) => e.id)).toEqual([unsent.id]);
    // The trackable was synced before: it comes back from the server.
    expect(await db.trackableDefinitions.count()).toBe(0);
    const meta = await getSyncMeta();
    expect(meta.cursor).toBe(0);
    expect(meta.sentThrough).toBeUndefined();
  });
});

// Last, since it deletes the database the other tests use.
describe('erase', () => {
  it('counts what is here, then deletes the whole local database', async () => {
    const trackable = await createTrackable({ name: 'Water', icon: 'x', color: '#000000', fieldIds: [] });
    await addTrackableEntry({ trackableId: trackable.id, timestamp: 1 });
    expect(await countLocalRecords()).toEqual({ fasts: 0, fieldDefinitions: 0, trackableDefinitions: 1, trackableEntries: 1, taskProjects: 0, tasks: 0, taskCompletions: 0 });
    await eraseLocalData();
    expect(await Dexie.exists('snowfast')).toBe(false);
  });
});
