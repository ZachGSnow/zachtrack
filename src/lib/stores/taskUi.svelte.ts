import { completeTask, db, skipTask, undoComplete, updateTask, type Task } from '../db';
import { describeDue, dayKey } from '../utils/tasks';

/**
 * The task sheet and the "Completed ... Undo" toast, shared by every page that
 * lists tasks (TaskHost.svelte renders them). Completing a task is one tap and
 * offers a few seconds to take it back, like one-tap logging (3.18). A
 * repeating task moves to its next date instead of closing (3.61).
 */
class TaskUi {
  /** The task the sheet shows; the sheet follows it as it changes or syncs. */
  taskId = $state<string | null>(null);
  open = $state(false);
  undo = $state<{ message: string; revert: () => Promise<unknown> } | null>(null);
  error = $state<string | null>(null);

  private undoTimer: ReturnType<typeof setTimeout> | undefined;

  show(id: string) {
    this.taskId = id;
    this.open = true;
  }

  private offerUndo(message: string, revert: () => Promise<unknown>) {
    clearTimeout(this.undoTimer);
    this.undo = { message, revert };
    this.undoTimer = setTimeout(() => (this.undo = null), 6000);
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

  async undoNow() {
    if (!this.undo) return;
    const { revert } = this.undo;
    this.undo = null;
    clearTimeout(this.undoTimer);
    await revert();
  }
}

export const taskUi = new TaskUi();
