import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyRemoteChanges,
  createTask,
  createTaskProject,
  db,
  deleteTask,
  deleteTaskProject,
  deleteTaskSection,
  getChangedSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  updateTask,
  type TaskCompletion,
} from '../src/lib/db';

// Tasks on the device (ARCHITECTURE.md 3.59): projects with sections, tasks
// with subtasks, deletes that take what hangs off them, and the one-time
// cursor reset of the v7 upgrade.

afterAll(() => db.close());

const sections = [
  { id: 's-now', name: 'In flight' },
  { id: 's-next', name: 'Queued' },
];

const wait = () => new Promise((r) => setTimeout(r, 5));

// First, while the shared `db` has not opened yet: a device coming from v6.
describe('the v7 upgrade', () => {
  it('keeps the data and resets the pull cursor so tasks synced earlier come down', async () => {
    const old = new Dexie('snowfast');
    old.version(6).stores({
      fasts: '++id, startTime, endTime, startDay, uuid',
      settings: 'id',
      fieldDefinitions: 'id, name',
      trackableDefinitions: 'id, name',
      trackableEntries: 'id, trackableId, timestamp',
      syncTombstones: '++id, recordType, uuid, deletedAt',
      syncMeta: 'id',
      syncLog: '++id, completedAt',
    });
    await old.table('syncMeta').put({ id: 'sync', cursor: 42, sentThrough: 1000, deviceId: 'dev-1' });
    await old.table('trackableDefinitions').put({ id: 't1', name: 'Water', icon: 'x', color: '#000', fieldIds: [], createdAt: 1, updatedAt: 1 });
    old.close();

    const meta = await getSyncMeta();
    expect(meta).toMatchObject({ cursor: 0, sentThrough: 1000, deviceId: 'dev-1' });
    expect(await db.trackableDefinitions.count()).toBe(1);
    expect(await db.tasks.count()).toBe(0);
  });
});

describe('tasks on the device', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('creates projects and tasks that the next sync sends', async () => {
    const since = Date.now();
    await wait();
    const project = await createTaskProject({ name: 'Home', color: '#3b82f6', sections });
    const parent = await createTask({ name: 'Garage', projectId: project.id, sectionId: 's-now', sortOrder: 1 });
    const sub = await createTask({ name: 'Buy hooks', parentId: parent.id, sortOrder: 1 });
    const changes = await getChangedSyncableRecords(since);
    expect(changes.taskProjects.map((p) => p.id)).toEqual([project.id]);
    expect(changes.tasks.map((t) => t.id).sort()).toEqual([parent.id, sub.id].sort());
  });

  it('removes a key set to undefined, so a due date can be cleared', async () => {
    const task = await createTask({ name: 'Call', dueOn: '2026-12-01', dueTime: '09:00', sortOrder: 1 });
    await updateTask(task.id, { dueOn: undefined, dueTime: undefined, notes: 'Ask about Friday' });
    const stored = await db.tasks.get(task.id);
    expect(stored).toMatchObject({ name: 'Call', notes: 'Ask about Friday' });
    expect(stored).not.toHaveProperty('dueOn');
    expect(stored).not.toHaveProperty('dueTime');
    expect(stored!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  it('deletes a task with its subtasks, at any depth, and their completions, and sends a delete for each', async () => {
    const parent = await createTask({ name: 'Garage', sortOrder: 1 });
    const child = await createTask({ name: 'Shelves', parentId: parent.id, sortOrder: 1 });
    const grandchild = await createTask({ name: 'Liners', parentId: child.id, sortOrder: 1 });
    const other = await createTask({ name: 'Unrelated', sortOrder: 2 });
    const completion: TaskCompletion = { id: 'c1', taskId: parent.id, completedAt: 1, createdAt: 1, updatedAt: 1 };
    await db.taskCompletions.put(completion);

    await deleteTask(parent.id);

    expect((await db.tasks.toArray()).map((t) => t.id)).toEqual([other.id]);
    expect(await db.taskCompletions.count()).toBe(0);
    const tombstones = await getPendingTombstones();
    expect(tombstones.map((t) => `${t.recordType}:${t.uuid}`).sort()).toEqual(
      [`tasks:${parent.id}`, `tasks:${child.id}`, `tasks:${grandchild.id}`, 'taskCompletions:c1'].sort(),
    );
    expect(tombstones.every((t) => t.label === 'Garage')).toBe(true);
  });

  it('deletes a project with all of its tasks', async () => {
    const home = await createTaskProject({ name: 'Home', color: '#3b82f6', sections });
    const work = await createTaskProject({ name: 'Work', color: '#ef4444', sections: [] });
    const t1 = await createTask({ name: 'Garage', projectId: home.id, sortOrder: 1 });
    await createTask({ name: 'Hooks', parentId: t1.id, sortOrder: 1 });
    const kept = await createTask({ name: 'Report', projectId: work.id, sortOrder: 1 });

    await deleteTaskProject(home.id);

    expect((await db.taskProjects.toArray()).map((p) => p.id)).toEqual([work.id]);
    expect((await db.tasks.toArray()).map((t) => t.id)).toEqual([kept.id]);
    const types = (await getPendingTombstones()).map((t) => t.recordType).sort();
    expect(types).toEqual(['taskProjects', 'tasks', 'tasks']);
  });

  it("removes a section, moving its tasks to another section or the project's top", async () => {
    const home = await createTaskProject({ name: 'Home', color: '#3b82f6', sections });
    const a = await createTask({ name: 'A', projectId: home.id, sectionId: 's-now', sortOrder: 1 });
    const b = await createTask({ name: 'B', projectId: home.id, sectionId: 's-next', sortOrder: 1 });

    await deleteTaskSection(home.id, 's-now', 's-next');
    expect((await db.taskProjects.get(home.id))!.sections).toEqual([{ id: 's-next', name: 'Queued' }]);
    expect((await db.tasks.get(a.id))!.sectionId).toBe('s-next');

    await deleteTaskSection(home.id, 's-next');
    expect((await db.taskProjects.get(home.id))!.sections).toEqual([]);
    expect(await db.tasks.get(a.id)).not.toHaveProperty('sectionId');
    expect(await db.tasks.get(b.id)).not.toHaveProperty('sectionId');
  });

  it('applies tasks from the server, and a project deleted elsewhere takes its tasks here without sending deletes back', async () => {
    const base = { fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null };
    await applyRemoteChanges({
      ...base,
      taskProjects: [{ id: 'p1', name: 'Home', color: '#000', sections, createdAt: 1, updatedAt: 1, updatedBy: 'dev-2' }],
      tasks: [
        { id: 'k1', name: 'Garage', projectId: 'p1', sortOrder: 1, createdAt: 1, updatedAt: 1 },
        { id: 'k2', name: 'Hooks', parentId: 'k1', sortOrder: 1, createdAt: 1, updatedAt: 1 },
      ],
      taskCompletions: [{ id: 'c1', taskId: 'k1', completedAt: 1, createdAt: 1, updatedAt: 1 }],
    });
    expect(await db.taskProjects.get('p1')).not.toHaveProperty('updatedBy');
    expect(await db.tasks.count()).toBe(2);

    await applyRemoteChanges({ ...base, taskProjects: [{ id: 'p1', name: 'Home', color: '#000', sections, createdAt: 1, updatedAt: 2, deletedAt: 2 }] });
    expect(await db.taskProjects.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.taskCompletions.count()).toBe(0);
    expect(await getPendingTombstones()).toEqual([]);
  });

  it('applies a sync response from a server older than tasks', async () => {
    await createTask({ name: 'Kept', sortOrder: 1 });
    await applyRemoteChanges({ fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null });
    expect(await db.tasks.count()).toBe(1);
  });
});
