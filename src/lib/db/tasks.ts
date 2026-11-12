// Task projects, tasks and completions (ARCHITECTURE.md 3.59).

import { dayKey } from '../utils/dayKey';
import { nextDue } from '../utils/taskRepeat';
import type { TaskProject, Task, TaskCompletion } from './types';
import { db, uuid, notifyMutation, addTombstone } from './schema';

// ---------------------------------------------------------------------------
// Task projects, tasks and completions (ARCHITECTURE.md 3.59)
// ---------------------------------------------------------------------------

export async function createTaskProject(input: Omit<TaskProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskProject> {
  const now = Date.now();
  const project: TaskProject = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  await db.taskProjects.add(project);
  notifyMutation();
  return project;
}

export async function updateTaskProject(id: string, patch: Partial<Omit<TaskProject, 'id' | 'createdAt'>>): Promise<void> {
  await db.taskProjects.update(id, { ...patch, updatedAt: Date.now() });
  notifyMutation();
}

/** A task and every subtask under it, at any depth, as ids. */
async function withDescendants(rootIds: string[]): Promise<string[]> {
  const all = [...rootIds];
  let level = rootIds;
  while (level.length > 0) {
    const children = await db.tasks.where('parentId').anyOf(level).primaryKeys();
    const fresh = children.filter((id) => !all.includes(id));
    all.push(...fresh);
    level = fresh;
  }
  return all;
}

/**
 * Deletes tasks with their subtasks and completion history. `tombstone`:
 * false when applying a delete that came from the server (nothing to send).
 */
/** Shared with sync.ts, which removes tasks another device deleted; not exported from the folder. */
export async function removeTasks(rootIds: string[], tombstone: boolean, label?: string): Promise<void> {
  const ids = await withDescendants(rootIds);
  const completionIds = await db.taskCompletions.where('taskId').anyOf(ids).primaryKeys();
  await db.taskCompletions.bulkDelete(completionIds);
  await db.tasks.bulkDelete(ids);
  if (!tombstone) return;
  for (const id of completionIds) await addTombstone('taskCompletions', id, label);
  for (const id of ids) await addTombstone('tasks', id, label);
}

/** Deletes a project with all of its tasks. */
export async function deleteTaskProject(id: string): Promise<void> {
  const project = await db.taskProjects.get(id);
  const taskIds = await db.tasks.where('projectId').equals(id).primaryKeys();
  await removeTasks(taskIds, true, project?.name);
  await db.taskProjects.delete(id);
  await addTombstone('taskProjects', id, project?.name);
  notifyMutation();
}

/**
 * Removes a section from a project. Its tasks move to `moveTo` (another
 * section of the same project), or to the top of the project when unset.
 */
export async function deleteTaskSection(projectId: string, sectionId: string, moveTo?: string): Promise<void> {
  const project = await db.taskProjects.get(projectId);
  if (!project) return;
  const now = Date.now();
  await db.transaction('rw', db.taskProjects, db.tasks, async () => {
    await db.taskProjects.update(projectId, { sections: project.sections.filter((s) => s.id !== sectionId), updatedAt: now });
    const moved = await db.tasks.where('projectId').equals(projectId).filter((t) => t.sectionId === sectionId).toArray();
    for (const t of moved) {
      const { sectionId: _old, ...rest } = t;
      await db.tasks.put({ ...rest, ...(moveTo ? { sectionId: moveTo } : {}), updatedAt: now });
    }
  });
  notifyMutation();
}

export async function createTask(input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
  const now = Date.now();
  const task: Task = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  await db.tasks.add(task);
  notifyMutation();
  return task;
}

/**
 * Changes a task. A key set to `undefined` in `patch` is removed (clearing a
 * due date, say), since Dexie's `update` would keep the old value.
 */
export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<void> {
  const current = await db.tasks.get(id);
  if (!current) return;
  const next: Record<string, unknown> = { ...current, ...patch, updatedAt: Date.now() };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  await db.tasks.put(next as unknown as Task);
  notifyMutation();
}

/**
 * Copies a task with its subtasks, at any depth, just below it: open again,
 * with its repeat rule and notes but without its completion history (3.65).
 */
export async function duplicateTask(id: string): Promise<Task | null> {
  const original = await db.tasks.get(id);
  if (!original) return null;
  const now = Date.now();
  const ids = await withDescendants([id]);
  const all = (await db.tasks.bulkGet(ids)).filter((t): t is Task => !!t);
  const newId = new Map(all.map((t) => [t.id, uuid()] as const));
  const copies = all.map((t) => {
    const { completedAt: _done, ...rest } = t;
    return {
      ...rest,
      id: newId.get(t.id)!,
      ...(t.parentId && newId.has(t.parentId) ? { parentId: newId.get(t.parentId)! } : {}),
      ...(t.id === id ? { sortOrder: t.sortOrder + 0.5 } : {}),
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.tasks.bulkAdd(copies);
  notifyMutation();
  return copies.find((c) => c.id === newId.get(id)) ?? null;
}

/**
 * Makes a task a subtask of `parentId`, or with null a task of its own in the
 * project and section its top-level task is in, just below that task (3.65).
 * Refuses to put a task under itself or one of its own subtasks.
 */
export async function setTaskParent(id: string, parentId: string | null): Promise<boolean> {
  const task = await db.tasks.get(id);
  if (!task) return false;
  const now = Date.now();
  if (parentId) {
    if ((await withDescendants([id])).includes(parentId)) return false;
    const siblings = await db.tasks.where('parentId').equals(parentId).toArray();
    const { projectId: _p, sectionId: _s, ...rest } = task;
    await db.tasks.put({ ...rest, parentId, sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1, updatedAt: now });
  } else {
    if (!task.parentId) return true;
    // The top-level task it was under, at whatever depth.
    let root = await db.tasks.get(task.parentId);
    for (let i = 0; root?.parentId && i < 100; i++) root = await db.tasks.get(root.parentId);
    const { parentId: _parent, ...rest } = task;
    await db.tasks.put({
      ...rest,
      ...(root?.projectId ? { projectId: root.projectId } : {}),
      ...(root?.sectionId ? { sectionId: root.sectionId } : {}),
      sortOrder: (root?.sortOrder ?? 0) + 0.5,
      updatedAt: now,
    });
  }
  notifyMutation();
  return true;
}

/** What completing a task did, so Undo can take it back. */
export type TaskCompleteResult =
  | { kind: 'closed'; taskId: string }
  | { kind: 'moved'; taskId: string; completionId: string; nextDueOn: string };

/**
 * Completes a task. One without a repeat rule is closed (`completedAt`). A
 * repeating one moves on instead (ARCHITECTURE.md 3.61): a completion row
 * records the due date it was done for, the task's `dueOn` moves to the next
 * date, and its completed subtasks, at any depth, are opened again for the
 * next round. The task itself never closes.
 */
export async function completeTask(id: string, now: number = Date.now()): Promise<TaskCompleteResult | null> {
  const result = await db.transaction('rw', db.tasks, db.taskCompletions, async () => {
    const task = await db.tasks.get(id);
    if (!task) return null;
    if (!task.repeat || !task.dueOn) {
      await db.tasks.put({ ...task, completedAt: now, updatedAt: now });
      return { kind: 'closed' as const, taskId: id };
    }
    const doneOn = dayKey(now);
    const nextDueOn = nextDue(task.repeat, task.dueOn, doneOn);
    const below = (await withDescendants([id])).filter((x) => x !== id);
    const reset = (await db.tasks.bulkGet(below)).filter((t): t is Task => !!t?.completedAt);
    for (const t of reset) {
      const { completedAt: _done, ...rest } = t;
      await db.tasks.put({ ...rest, updatedAt: now });
    }
    const completion: TaskCompletion = {
      id: uuid(),
      taskId: id,
      completedAt: now,
      dueOn: task.dueOn,
      nextDueOn,
      ...(reset.length ? { subtaskIds: reset.map((t) => t.id) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await db.taskCompletions.add(completion);
    const { completedAt: _c, ...open } = task;
    await db.tasks.put({ ...open, dueOn: nextDueOn, updatedAt: now });
    return { kind: 'moved' as const, taskId: id, completionId: completion.id, nextDueOn };
  });
  notifyMutation();
  return result;
}

/**
 * Takes a completion back: reopens a closed task, or for a repeating one puts
 * the due date and the subtasks back as they were and removes the completion
 * row. The date only goes back while the task is still on the date the
 * completion moved it to, so an edit made since isn't undone.
 */
export async function undoComplete(result: TaskCompleteResult): Promise<void> {
  const now = Date.now();
  let removed: string | null = null;
  await db.transaction('rw', db.tasks, db.taskCompletions, async () => {
    const task = await db.tasks.get(result.taskId);
    if (result.kind === 'closed') {
      if (task?.completedAt) {
        const { completedAt: _c, ...rest } = task;
        await db.tasks.put({ ...rest, updatedAt: now });
      }
      return;
    }
    const completion = await db.taskCompletions.get(result.completionId);
    if (!completion) return;
    if (task && task.dueOn === completion.nextDueOn && completion.dueOn) {
      await db.tasks.put({ ...task, dueOn: completion.dueOn, updatedAt: now });
    }
    for (const sub of await db.tasks.bulkGet(completion.subtaskIds ?? [])) {
      if (sub && !sub.completedAt) await db.tasks.put({ ...sub, completedAt: completion.completedAt, updatedAt: now });
    }
    await db.taskCompletions.delete(completion.id);
    removed = completion.id;
  });
  if (removed) await addTombstone('taskCompletions', removed, undefined);
  notifyMutation();
}

/** Moves a repeating task to its next date without completing it. Returns the date it was on, for Undo. */
export async function skipTask(id: string, now: number = Date.now()): Promise<string | null> {
  const task = await db.tasks.get(id);
  if (!task?.repeat || !task.dueOn) return null;
  const was = task.dueOn;
  // A fixed schedule skips to its next date after today; "after it's done" to one interval after the due date.
  const nextDueOn = nextDue(task.repeat, was, task.repeat.type === 'afterDone' ? was : dayKey(now));
  await db.tasks.put({ ...task, dueOn: nextDueOn, updatedAt: now });
  notifyMutation();
  return was;
}

/** Deletes a task with its subtasks and completion history. */
export async function deleteTask(id: string): Promise<void> {
  const task = await db.tasks.get(id);
  // The label names the project, not the task: a task's name is its content,
  // and this device's sync history keeps the label for 30 days (3.59).
  let root = task;
  for (let i = 0; root?.parentId && i < 100; i++) root = await db.tasks.get(root.parentId);
  const project = root?.projectId ? await db.taskProjects.get(root.projectId) : undefined;
  await removeTasks([id], true, project?.name ?? 'Inbox');
  notifyMutation();
}
