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

describe('tasks in the export file (v1.19.0)', () => {
  const project = { id: 'p1', name: 'Home', color: '#3b82f6', sections: [{ id: 's1', name: 'In flight' }], createdAt: T0, updatedAt: T0 };
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Task ${id}`, sortOrder: 1, createdAt: T0, updatedAt: T0, ...extra });

  it('exports and imports projects, tasks and completions', () => {
    const text = fileText({
      taskProjects: [project],
      tasks: [task('k1', { projectId: 'p1', dueOn: '2026-12-01', repeat: { type: 'years', every: 1 } }), task('k2', { parentId: 'k1' })],
      taskCompletions: [{ id: 'c1', taskId: 'k1', completedAt: T0, createdAt: T0, updatedAt: T0 }],
    });
    const result = planImport(text, snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.changes.taskProjects).toHaveLength(1);
    expect(result.plan.changes.tasks.map((t) => t.id)).toEqual(['k1', 'k2']);
    expect(result.plan.changes.taskCompletions).toHaveLength(1);
    expect(result.plan.added).toBe(4);
    expect(result.plan.skipped).toEqual([]);
  });

  it('skips a task whose project or parent is missing, and a completion whose task is missing', () => {
    const text = fileText({
      tasks: [task('k1', { projectId: 'p-gone' }), task('k2', { parentId: 'k-gone' }), task('k3')],
      taskCompletions: [{ id: 'c1', taskId: 'k-gone', completedAt: T0, createdAt: T0, updatedAt: T0 }],
    });
    const result = planImport(text, snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.changes.tasks.map((t) => t.id)).toEqual(['k3']);
    expect(result.plan.skipped.map((s) => [s.recordType, s.id])).toEqual([
      ['tasks', 'k1'],
      ['tasks', 'k2'],
      ['taskCompletions', 'c1'],
    ]);
  });

  it('reads a file from before tasks', () => {
    const file = JSON.parse(fileText({ trackableDefinitions: [nutrition] }));
    delete file.data.taskProjects;
    delete file.data.tasks;
    delete file.data.taskCompletions;
    const result = planImport(JSON.stringify(file), snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.changes.tasks).toEqual([]);
    expect(result.plan.added).toBe(1);
  });
});

describe('what an import may bring (safety, v1.21.0)', () => {
  const T = Date.UTC(2026, 9, 1);
  // One record of each kind with every field it can have set.
  const full = {
    fieldDefinitions: [{ id: 'f1', name: 'Water', kind: 'number', unit: 'oz', ratingMin: 1, ratingMax: 5, aggregation: 'sum', createdAt: T, updatedAt: T }],
    trackableDefinitions: [
      {
        id: 't1', name: 'Water', icon: 'W', color: '#38bdf8', fieldIds: ['f1'], displayMode: 'daily', goalType: 'dailyTotal', goalValue: 64, pinned: true,
        archived: false, sortOrder: 2, scheduleDays: [0, 2], skipDays: ['2026-10-02'], pausedUntil: T, dateKind: 'birthday', dateLeadDays: 3,
        insightsHidden: true, scheduleHistory: [{ until: T, scheduleDays: [1] }], createdAt: T, updatedAt: T,
      },
    ],
    trackableEntries: [{ id: 'e1', trackableId: 't1', timestamp: T, note: 'n', tags: ['a'], values: { f1: 8 }, dateRepeat: { type: 'yearly' }, details: 'd', createdAt: T, updatedAt: T }],
    fasts: [{ uuid: 'u1', startTime: T, startDay: T, endTime: T + 1, method: 'preset', presetId: '16:8', presetLabel: '16:8', targetHours: 16, moodRating: 3, energyRating: 3, hungerRating: 3, tags: ['x'], note: 'n', createdAt: T, updatedAt: T }],
    taskProjects: [{ id: 'p1', name: 'Home', color: '#a855f7', icon: 'H', notes: 'n', sections: [{ id: 's1', name: 'Now' }], archived: false, sortOrder: 1, createdAt: T, updatedAt: T }],
    tasks: [{ id: 'k1', name: 'Oil', projectId: 'p1', sectionId: 's1', notes: 'n', dueOn: '2026-12-01', dueTime: '09:00', repeat: { type: 'days', every: 2 }, completedAt: T, sortOrder: 1, createdAt: T, updatedAt: T }, { id: 'k2', name: 'Sub', parentId: 'k1', sortOrder: 0, createdAt: T, updatedAt: T }],
    taskCompletions: [{ id: 'c1', taskId: 'k1', completedAt: T, dueOn: '2026-11-01', nextDueOn: '2026-11-03', subtaskIds: ['k2'], createdAt: T, updatedAt: T }],
    settings: {
      id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: false, heightInches: 70, goalWeightLb: 180, weightFieldId: 'f1', waistFieldId: 'f1', neckFieldId: 'f1',
      hipFieldId: 'f1', bodyFatSex: 'male', fastScheduleTime: '20:00', customFastPresets: [{ id: 'c', label: '20:4', targetHours: 20 }], fastWeekPlan: [null, null, null, null, null, null, null],
      mutedInsights: ['a|b|0'], updatedAt: T,
    },
  };
  const file = (data: object) => JSON.stringify({ format: 'zachtrack-export', version: 1, exportedAt: new Date(T).toISOString(), data });

  it('keeps every field of every kind of record', () => {
    const result = planImport(file(full), snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.skipped).toEqual([]);
    const c = result.plan.changes;
    expect(c.fieldDefinitions).toEqual(full.fieldDefinitions);
    expect(c.trackableDefinitions).toEqual(full.trackableDefinitions);
    expect(c.trackableEntries).toEqual(full.trackableEntries);
    expect(c.fasts).toEqual(full.fasts);
    expect(c.taskProjects).toEqual(full.taskProjects);
    expect(c.tasks).toEqual(full.tasks);
    expect(c.taskCompletions).toEqual(full.taskCompletions);
    expect(c.settings).toEqual(full.settings);
  });

  it('drops a deletedAt and anything else that is not data, so an import can never delete', () => {
    const sneaky = { ...full.trackableDefinitions[0], deletedAt: T, updatedBy: 'dev', huge: 'x'.repeat(100) };
    const result = planImport(file({ trackableDefinitions: [sneaky] }), snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.changes.trackableDefinitions[0]).toEqual(full.trackableDefinitions[0]);
  });

  it('skips a record changed in the future, which would win every later edit', () => {
    const later = Date.now() + 3 * 24 * 3600_000;
    const result = planImport(file({ fieldDefinitions: [{ ...full.fieldDefinitions[0], updatedAt: later }] }), snapshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.changes.fieldDefinitions).toEqual([]);
    expect(result.plan.skipped).toEqual([expect.objectContaining({ recordType: 'fieldDefinitions', reason: expect.stringContaining('no later than tomorrow') })]);
  });
});
