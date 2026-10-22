import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  getAllSyncableRecords,
  getSettings,
  importRecords,
  onLocalMutation,
  type FastRecord,
  type FieldDefinition,
  type TrackableDefinition,
  type TrackableEntry,
} from '../src/lib/db';
import { buildExport, exportFileName, planImport, type LocalSnapshot } from '../src/lib/dataFile';

const T0 = Date.UTC(2026, 9, 20, 12);
const day = (d: number) => new Date(2026, 9, d).getTime();

const water: FieldDefinition = { id: 'f-water', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: T0, updatedAt: T0 };
const nutrition: TrackableDefinition = { id: 't-n', name: 'Nutrition', icon: 'x', color: '#f97316', fieldIds: ['f-water'], createdAt: T0, updatedAt: T0 };
const entry = (id: string, updatedAt: number, oz: number, extra: Partial<TrackableEntry> = {}): TrackableEntry => ({
  id,
  trackableId: 't-n',
  timestamp: day(20) + 9 * 3600000,
  values: { 'f-water': oz },
  createdAt: T0,
  updatedAt,
  ...extra,
});
const fast = (uuid: string, d: number, updatedAt: number, id?: number): FastRecord => ({
  ...(id != null ? { id } : {}),
  uuid,
  startTime: day(d) + 20 * 3600000,
  startDay: day(d),
  endTime: day(d) + 36 * 3600000,
  method: 'preset',
  presetId: '16:8',
  note: "felt 'fine'\nslept ok",
  tags: ['test'],
  createdAt: T0,
  updatedAt,
});

const snapshot = (over: Partial<LocalSnapshot> = {}): LocalSnapshot => ({
  fasts: [],
  fieldDefinitions: [],
  trackableDefinitions: [],
  trackableEntries: [],
  settings: null,
  ...over,
});
const fileText = (data: Partial<LocalSnapshot>) => JSON.stringify(buildExport(snapshot(data), new Date(T0)));

describe('planImport', () => {
  it('refuses files that are not a ZachTrack export', () => {
    expect(planImport('not json', snapshot())).toEqual({ ok: false, error: 'This file is not valid JSON.' });
    expect(planImport('{"hello":1}', snapshot())).toMatchObject({ ok: false, error: expect.stringContaining('not a ZachTrack export') });
    expect(planImport('{"format":"zachtrack-export","version":99,"data":{}}', snapshot())).toMatchObject({ ok: false, error: expect.stringContaining('version 99') });
  });

  it('adds new records, updates older ones, and leaves same or newer ones alone', () => {
    const local = snapshot({
      fieldDefinitions: [water],
      trackableDefinitions: [nutrition],
      trackableEntries: [entry('older-here', T0, 1), entry('newer-here', T0 + 500, 2), entry('same', T0, 3)],
    });
    const text = fileText({
      fieldDefinitions: [water],
      trackableDefinitions: [nutrition],
      trackableEntries: [entry('older-here', T0 + 100, 10), entry('newer-here', T0 + 100, 20), entry('same', T0, 3), entry('brand-new', T0, 4)],
    });
    const result = planImport(text, local);
    if (!result.ok) throw new Error(result.error);
    const { plan } = result;
    expect(plan.changes.trackableEntries.map((e) => e.id)).toEqual(['older-here', 'brand-new']);
    expect(plan.changes.trackableEntries[0].values).toEqual({ 'f-water': 10 });
    expect([plan.added, plan.updated, plan.unchanged]).toEqual([1, 1, 4]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips invalid records, orphan entries and a fast on a day another fast owns, and keeps the rest', () => {
    const local = snapshot({ fasts: [fast('here', 20, T0, 1)] });
    const text = fileText({
      trackableDefinitions: [nutrition],
      trackableEntries: [entry('ok', T0, 1), entry('orphan', T0, 1, { trackableId: 't-missing' }), { ...entry('bad', T0, 1), values: { 'f-water': 'lots' } } as never],
      fasts: [fast('other-same-day', 20, T0 + 1), fast('next-day', 21, T0)],
    });
    const result = planImport(text, local);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.skipped.map((s) => `${s.recordType}:${s.id}`).sort()).toEqual([
      'fasts:other-same-day',
      'trackableEntries:bad',
      'trackableEntries:orphan',
    ]);
    expect(result.plan.changes.fasts.map((f) => f.uuid)).toEqual(['next-day']);
    expect(result.plan.changes.trackableEntries.map((e) => e.id)).toEqual(['ok']);
  });

  it("imports settings over a fresh device's defaults, but not over a newer edit", async () => {
    const fileSettings = { id: 'app-settings' as const, defaultPresetId: '18:6', notificationsEnabled: true, heightInches: 70, updatedAt: T0 };
    const fresh = { id: 'app-settings' as const, defaultPresetId: '16:8', notificationsEnabled: false, updatedAt: 0 };
    const onFresh = planImport(fileText({ settings: fileSettings }), snapshot({ settings: fresh }));
    expect(onFresh.ok && onFresh.plan.changes.settings?.heightInches).toBe(70);
    const onEdited = planImport(fileText({ settings: fileSettings }), snapshot({ settings: { ...fresh, updatedAt: T0 + 1 } }));
    expect(onEdited.ok && onEdited.plan.changes.settings).toBeNull();
  });

  it('names the file by local date', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 30))).toBe('zachtrack-export-2026-01-05.json');
  });
});

describe('export then import on another device (real db.ts on fake IndexedDB)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  afterAll(() => {
    db.close();
  });

  async function seedDevice() {
    await db.fieldDefinitions.add(water);
    await db.trackableDefinitions.add(nutrition);
    await db.trackableEntries.bulkAdd([entry('e1', T0, 12, { note: "it's\n\ud83d\ude34", tags: ['x'] }), entry('e2', T0, 8)]);
    await db.fasts.add(fast('fast-1', 19, T0));
    await db.settings.put({ id: 'app-settings', defaultPresetId: '18:6', notificationsEnabled: true, heightInches: 70, goalWeightLb: 175, updatedAt: T0 });
  }

  const comparable = (s: Awaited<ReturnType<typeof getAllSyncableRecords>>) => ({
    ...s,
    fasts: s.fasts.map(({ id: _id, ...f }) => f),
  });

  it('restores every record on a fresh device and syncs them', async () => {
    await seedDevice();
    const original = await getAllSyncableRecords();
    const text = JSON.stringify(buildExport(original, new Date(T0)));

    // Fresh device: nothing local except the defaults created on first launch.
    await Promise.all(db.tables.map((t) => t.clear()));
    await getSettings();
    const result = planImport(text, await getAllSyncableRecords());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.skipped).toEqual([]);

    let notified = 0;
    const stop = onLocalMutation(() => notified++);
    await importRecords(result.plan.changes);
    stop();

    expect(comparable(await getAllSyncableRecords())).toEqual(comparable(original));
    expect(notified).toBe(1);
  });

  it('importing the same file twice changes nothing the second time', async () => {
    await seedDevice();
    const text = JSON.stringify(buildExport(await getAllSyncableRecords(), new Date(T0)));
    const again = planImport(text, await getAllSyncableRecords());
    if (!again.ok) throw new Error(again.error);
    expect([again.plan.added, again.plan.updated]).toEqual([0, 0]);
  });

  it('never deletes: records missing from the file stay', async () => {
    await seedDevice();
    const text = JSON.stringify(buildExport(snapshot({ trackableDefinitions: [nutrition] }), new Date(T0)));
    const result = planImport(text, await getAllSyncableRecords());
    if (!result.ok) throw new Error(result.error);
    await importRecords(result.plan.changes);
    expect(await db.trackableEntries.count()).toBe(2);
    expect(await db.fasts.count()).toBe(1);
  });
});
