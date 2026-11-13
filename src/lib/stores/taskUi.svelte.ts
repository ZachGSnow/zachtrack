import { completeTask, db, skipTask, undoComplete, updateTask, type Task, type TaskSection } from '../db';
import { describeDue, dayKey, nextSortOrder } from '../utils/tasks';
import { followDueDate } from '../utils/taskRepeat';
import { undoToast } from './undo.svelte';

/**
 * The task sheet and the "Completed ... Undo" toast, shared by every page that
 * lists tasks (TaskHost.svelte renders them). Completing a task is one tap and
 * offers a few seconds to take it back, like one-tap logging (3.18). A
 * repeating task moves to its next date instead of closing (3.61).
 */
class TaskUi {
  /** The task whose date the reschedule sheet is changing (a tap on a row's date, or a swipe). */
  rescheduleId = $state<string | null>(null);
  /** The task the sheet shows; the sheet follows it as it changes or syncs. */
  taskId = $state<string | null>(null);
  open = $state(false);
  error = $state<string | null>(null);
  /** The task whose quick menu is open: a long press or right-click on a row or card (3.77). */
  menuId = $state<string | null>(null);
  /** Tasks picked with Ctrl+click (Cmd+click on a Mac) on a project page, to drag together (3.77). */
  selected = $state<string[]>([]);
  /** A project page is showing, where Ctrl+click selects. */
  selectable = $state(false);

  toggleSelected(id: string) {
    this.selected = this.selected.includes(id) ? this.selected.filter((x) => x !== id) : [...this.selected, id];
  }

  clearSelection() {
    if (this.selected.length > 0) this.selected = [];
  }

  /** A Ctrl+click (Cmd+click) on an open task of a project page selects it instead of opening it; true when it did. */
  pick(e: { ctrlKey: boolean; metaKey: boolean; preventDefault(): void }, task: Task): boolean {
    if (!this.selectable || !(e.ctrlKey || e.metaKey) || task.completedAt || task.parentId) return false;
    e.preventDefault();
    this.toggleSelected(task.id);
    return true;
  }

  show(id: string) {
    this.taskId = id;
    this.open = true;
  }

  private offerUndo(message: string, revert: () => Promise<unknown>) {
    undoToast.offer(message, revert);
  }

  private async attempt(work: () => Promise<void>) {
    this.error = null;
    try {
      await work();
    } catch (err) {
      this.error = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Completes an open task (or moves a repeating one on), or reopens a completed one, with Undo. */
  toggle(task: Task) {
    return this.attempt(async () => {
      // Read the current copy: the row may hold one from before a sync.
      const current = await db.tasks.get(task.id);
      if (!current) return;
      if (current.completedAt) {
        const was = current.completedAt;
        await updateTask(current.id, { completedAt: undefined });
        this.offerUndo(`Reopened ${current.name}`, () => updateTask(current.id, { completedAt: was }));
        return;
      }
      const result = await completeTask(current.id);
      if (!result) return;
      const message =
        result.kind === 'moved'
          ? `${current.name} done. Next: ${describeDue(result.nextDueOn, current.dueTime, dayKey(Date.now())).text}`
          : `Completed ${current.name}`;
      this.offerUndo(message, () => undoComplete(result));
    });
  }

  /** Moves a repeating task to its next date without completing it, with Undo. */
  skip(task: Task) {
    return this.attempt(async () => {
      const was = await skipTask(task.id);
      if (!was) return;
      const now = await db.tasks.get(task.id);
      const next = now?.dueOn;
      this.offerUndo(`Skipped to ${next ? describeDue(next, now?.dueTime, dayKey(Date.now())).text : 'the next date'}`, async () => {
        const current = await db.tasks.get(task.id);
        if (current && current.dueOn === next) await updateTask(task.id, { dueOn: was });
      });
    });
  }

  /**
   * Moves a task to `dueOn` (undefined: no date, which also drops its time and
   * repeat). A repeating task's rule follows the date (followDueDate). With Undo.
   */
  reschedule(task: Task, dueOn: string | undefined) {
    return this.attempt(async () => {
      const current = await db.tasks.get(task.id);
      if (!current || current.dueOn === dueOn) return;
      const before = { dueOn: current.dueOn, dueTime: current.dueTime, repeat: current.repeat };
      await updateTask(current.id, dueOnPatch(current, dueOn));
      const today = dayKey(Date.now());
      this.offerUndo(dueOn ? `Moved ${current.name} to ${describeDue(dueOn, current.dueTime, today).text}` : `Cleared the date of ${current.name}`, () =>
        updateTask(current.id, before),
      );
    });
  }

  /** Moves a task to the end of a section of its project (null: no section), with Undo. */
  moveToSection(task: Task, section: TaskSection | null) {
    return this.attempt(async () => {
      const current = await db.tasks.get(task.id);
      const to = section?.id;
      if (!current || current.parentId || current.sectionId === to) return;
      const siblings = await db.tasks.filter((t) => !t.parentId && t.projectId === current.projectId && t.sectionId === to && t.id !== current.id).toArray();
      const before = { sectionId: current.sectionId, sortOrder: current.sortOrder };
      await updateTask(current.id, { sectionId: to, sortOrder: nextSortOrder(siblings) });
      this.offerUndo(`Moved ${current.name} to ${section?.name ?? 'No section'}`, () => updateTask(current.id, before));
    });
  }

  /** Moves every overdue task in `tasks` to today, with one Undo for all of them. */
  moveOverdue(tasks: readonly Task[], today: string) {
    return this.attempt(async () => {
      const before: Array<{ id: string; patch: Partial<Task> }> = [];
      for (const t of tasks) {
        const current = await db.tasks.get(t.id);
        if (!current?.dueOn || current.completedAt || current.dueOn >= today) continue;
        before.push({ id: current.id, patch: { dueOn: current.dueOn, repeat: current.repeat } });
        await updateTask(current.id, dueOnPatch(current, today));
      }
      if (before.length === 0) return;
      this.offerUndo(`Moved ${before.length} task${before.length === 1 ? '' : 's'} to today`, async () => {
        for (const b of before) await updateTask(b.id, b.patch);
      });
    });
  }
}

/** The change that moves a task to `dueOn`, keeping a repeat rule in step or clearing time and repeat with the date. */
export function dueOnPatch(task: Task, dueOn: string | undefined): Partial<Task> {
  if (!dueOn) return { dueOn: undefined, dueTime: undefined, repeat: undefined };
  return { dueOn, ...(task.repeat && task.dueOn ? { repeat: followDueDate(task.repeat, task.dueOn, dueOn) } : {}) };
}

export const taskUi = new TaskUi();
