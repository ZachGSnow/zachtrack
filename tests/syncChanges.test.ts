import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addTrackableEntry,
  countWaitingChanges,
  createTrackable,
  db,
  deleteTrackableEntry,
  getChangedSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  importRecords,
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
