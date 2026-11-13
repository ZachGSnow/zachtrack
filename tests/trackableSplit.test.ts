import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addTrackableEntry,
  createFieldDefinition,
  createTrackable,
  db,
  getChangedSyncableRecords,
  mergeTrackable,
  splitTrackable,
  undoMergeTrackable,
  undoSplitTrackable,
} from '../src/lib/db';
import { canSplit, mergedFieldIds, mergeTargets, planSplit } from '../src/lib/utils/trackableSplit';

// Splitting a trackable by field and merging one into another (ARCHITECTURE.md
// 3.72), keeping every entry. Fictional data.

afterAll(() => db.close());

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const wait = () => new Promise((r) => setTimeout(r, 5));

describe('planning a split', () => {
  it('sends each entry with one field to that field, and keeps the rest', () => {
    const plan = planSplit({ fieldIds: ['run', 'swim'] }, [
      { id: 'a', values: { run: 3 } },
      { id: 'b', values: { swim: 1 } },
      { id: 'c', values: { run: 2, swim: 1 } },
      { id: 'd', values: {} },
      { id: 'e', values: { run: 4, other: 1 } },
    ]);
    expect(plan.parts).toEqual([
      { fieldId: 'run', entryIds: ['a', 'e'] },
      { fieldId: 'swim', entryIds: ['b'] },
    ]);
    expect(plan.staying).toEqual(['c', 'd']);
  });

  it('needs two fields, and leaves dates alone', () => {
    expect(canSplit({ fieldIds: ['a', 'b'] })).toBe(true);
    expect(canSplit({ fieldIds: ['a'] })).toBe(false);
    expect(canSplit({ fieldIds: ['a', 'b'], displayMode: 'ages' })).toBe(false);
  });

  it('merges into any other active trackable, adding the fields the target lacks', () => {
    const all = [
      { id: '1', name: 'Swim', displayMode: undefined, archived: undefined },
      { id: '2', name: 'Birthdays', displayMode: 'ages' as const },
      { id: '3', name: 'Old', archived: true },
      { id: '4', name: 'Cycle' },
    ];
    expect(mergeTargets({ id: '1' }, all).map((t) => t.name)).toEqual(['Cycle']);
    expect(mergedFieldIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

async function exercise() {
  const run = await createFieldDefinition({ name: 'Run', kind: 'rating', ratingMin: 1, ratingMax: 5 });
  const swim = await createFieldDefinition({ name: 'Swim', kind: 'rating', ratingMin: 1, ratingMax: 5 });
  const t = await createTrackable({ name: 'Exercise', icon: 'x', color: '#336699', fieldIds: [run.id, swim.id], goalType: 'perWeek', goalValue: 3, pinned: true });
  const runs = [await addTrackableEntry({ trackableId: t.id, timestamp: 1, values: { [run.id]: 4 }, note: 'Park loop' }), await addTrackableEntry({ trackableId: t.id, timestamp: 2, values: { [run.id]: 3 } })];
  const swims = [await addTrackableEntry({ trackableId: t.id, timestamp: 3, values: { [swim.id]: 5 } })];
  return { run, swim, t, runs, swims };
}

describe('splitting a trackable', () => {
  it('moves each entry to its field, gives the goal to the chosen part, archives the empty original, and undoes', async () => {
    const { run, swim, t, runs, swims } = await exercise();
    await wait();
    const since = Date.now();
    const result = await splitTrackable(t.id, run.id);

    expect(result.archived).toBe(true);
    const [runT, swimT] = await Promise.all(result.created.map((c) => db.trackableDefinitions.get(c.id)));
    expect(runT).toMatchObject({ name: 'Run', fieldIds: [run.id], goalType: 'perWeek', goalValue: 3, pinned: true, icon: 'x', color: '#336699' });
    expect(swimT).toMatchObject({ name: 'Swim', fieldIds: [swim.id], pinned: true });
    expect(swimT?.goalType).toBeUndefined();
    const moved = await db.trackableEntries.where('trackableId').equals(runT!.id).toArray();
    expect(moved.map((e) => e.id).sort()).toEqual(runs.map((e) => e.id).sort());
    expect(moved.find((e) => e.id === runs[0].id)).toMatchObject({ timestamp: 1, note: 'Park loop', values: { [run.id]: 4 } });
    expect(await db.trackableEntries.where('trackableId').equals(swimT!.id).count()).toBe(1);
    const original = await db.trackableDefinitions.get(t.id);
    expect(original).toMatchObject({ archived: true });
    expect(original?.goalType).toBeUndefined();

    // The next sync sends the moves as edits.
    const changed = await getChangedSyncableRecords(since);
    expect(changed.trackableEntries.map((e) => e.id).sort()).toEqual([...runs, ...swims].map((e) => e.id).sort());
    expect(changed.trackableDefinitions).toHaveLength(3);

    await undoSplitTrackable(result, t);
    expect(await db.trackableEntries.where('trackableId').equals(t.id).count()).toBe(3);
    expect(await db.trackableDefinitions.get(t.id)).toMatchObject({ goalType: 'perWeek', goalValue: 3 });
    expect((await db.trackableDefinitions.get(t.id))?.archived).toBeUndefined();
    expect(await db.trackableDefinitions.count()).toBe(1);
    expect((await db.syncTombstones.toArray()).map((s) => s.recordType)).toEqual(['trackableDefinitions', 'trackableDefinitions']);
  });

  it('keeps entries with both fields in the original, which then stays', async () => {
    const { run, swim, t } = await exercise();
    await addTrackableEntry({ trackableId: t.id, timestamp: 4, values: { [run.id]: 2, [swim.id]: 2 } });
    const result = await splitTrackable(t.id);
    expect(result.archived).toBe(false);
    expect(await db.trackableEntries.where('trackableId').equals(t.id).count()).toBe(1);
    // No part was picked for the goal: it stays with the original.
    expect(await db.trackableDefinitions.get(t.id)).toMatchObject({ goalType: 'perWeek' });
  });

  it('refuses a trackable with one field', async () => {
    const one = await createTrackable({ name: 'Walk', icon: 'x', color: '#000000', fieldIds: ['f'] });
    await expect(splitTrackable(one.id)).rejects.toThrow(/two or more fields/);
  });
});

describe('merging a trackable', () => {
  it('moves every entry, adds the fields, archives the source, and undoes', async () => {
    const { run, swim, t } = await exercise();
    const cycle = await createFieldDefinition({ name: 'Cycle', kind: 'number' });
    const target = await createTrackable({ name: 'Cardio', icon: 'y', color: '#000000', fieldIds: [cycle.id, run.id] });
    await addTrackableEntry({ trackableId: target.id, timestamp: 9, values: { [cycle.id]: 10 } });

    const result = await mergeTrackable(t.id, target.id);
    expect(await db.trackableEntries.where('trackableId').equals(target.id).count()).toBe(4);
    expect((await db.trackableDefinitions.get(target.id))?.fieldIds).toEqual([cycle.id, run.id, swim.id]);
    expect(await db.trackableDefinitions.get(t.id)).toMatchObject({ archived: true });

    await undoMergeTrackable(result);
    expect(await db.trackableEntries.where('trackableId').equals(t.id).count()).toBe(3);
    expect(await db.trackableEntries.where('trackableId').equals(target.id).count()).toBe(1);
    expect((await db.trackableDefinitions.get(target.id))?.fieldIds).toEqual([cycle.id, run.id]);
    expect((await db.trackableDefinitions.get(t.id))?.archived).toBeUndefined();
  });
});
