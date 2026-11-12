import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTrackable, db } from '../src/lib/db';
import { quickLog } from '../src/lib/stores/quickLog.svelte';
import { taskUi } from '../src/lib/stores/taskUi.svelte';
import { undoToast } from '../src/lib/stores/undo.svelte';
import { dayKey } from '../src/lib/utils/dayKey';

// One-tap logging and completing a task, each with a few seconds to undo
// through the one undo message (ARCHITECTURE.md 3.67). Fictional data.

afterAll(() => db.close());

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  undoToast.current = null;
});

const stretch = () => createTrackable({ name: 'Stretch', icon: 'x', color: '#336699', fieldIds: [] });

describe('quick log', () => {
  it('logs a trackable without fields in one tap, and Undo takes the entry back off', async () => {
    const t = await stretch();
    await quickLog.log(t);
    expect(await db.trackableEntries.where('trackableId').equals(t.id).count()).toBe(1);
    expect(undoToast.current?.message).toBe('Logged Stretch');
    await undoToast.undo();
    expect(undoToast.current).toBeNull();
    expect(await db.trackableEntries.where('trackableId').equals(t.id).count()).toBe(0);
  });

  it('unchecking today removes the entry, and Undo puts it back', async () => {
    const t = await stretch();
    await quickLog.log(t);
    const entries = await db.trackableEntries.toArray();
    await quickLog.uncheck(t, entries);
    expect(undoToast.current?.message).toBe('Unchecked Stretch');
    expect(await db.trackableEntries.count()).toBe(0);
    await undoToast.undo();
    expect(await db.trackableEntries.count()).toBe(1);
  });

  it('opens the sheet instead for a trackable with fields', async () => {
    const t = await createTrackable({ name: 'Water', icon: 'x', color: '#336699', fieldIds: ['f-oz'] });
    await quickLog.log(t);
    expect(quickLog.sheetOpen).toBe(true);
    expect(quickLog.sheetTrackable?.id).toBe(t.id);
    expect(await db.trackableEntries.count()).toBe(0);
    expect(undoToast.current).toBeNull();
    quickLog.sheetOpen = false;
  });
});

describe('completing a task', () => {
  it('completes a one-off task, and Undo reopens it', async () => {
    const task = await createTask({ name: 'Post the parcel', sortOrder: 1 });
    await taskUi.toggle(task);
    expect((await db.tasks.get(task.id))?.completedAt).toBeTruthy();
    expect(undoToast.current?.message).toBe('Completed Post the parcel');
    await undoToast.undo();
    expect((await db.tasks.get(task.id))?.completedAt).toBeFalsy();
  });

  it('moves a repeating task to its next date, and Undo moves it back', async () => {
    const today = dayKey(Date.now());
    const task = await createTask({ name: 'Water the ferns', sortOrder: 1, dueOn: today, repeat: { type: 'days', every: 3 } });
    await taskUi.toggle(task);
    const moved = await db.tasks.get(task.id);
    expect(moved?.completedAt).toBeFalsy();
    expect(moved?.dueOn).not.toBe(today);
    expect(undoToast.current?.message).toMatch(/^Water the ferns done\. Next: /);
    await undoToast.undo();
    expect((await db.tasks.get(task.id))?.dueOn).toBe(today);
  });

  it('a newer undo message replaces the older one, whose change stays', async () => {
    const t = await stretch();
    const task = await createTask({ name: 'Post the parcel', sortOrder: 1 });
    await quickLog.log(t);
    await taskUi.toggle(task);
    expect(undoToast.current?.message).toBe('Completed Post the parcel');
    await undoToast.undo();
    expect(await db.trackableEntries.count()).toBe(1);
  });
});
