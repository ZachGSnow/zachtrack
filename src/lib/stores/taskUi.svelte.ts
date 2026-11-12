import { db, updateTask, type Task } from '../db';

/**
 * The task sheet and the "Completed ... Undo" toast, shared by every page that
 * lists tasks (TaskHost.svelte renders them). Completing a task is one tap and
 * offers a few seconds to take it back, like one-tap logging (3.18).
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

  /** Completes an open task or reopens a completed one, with Undo. */
  async toggle(task: Task) {
    this.error = null;
    try {
      // Read the current copy: the row may hold one from before a sync.
      const current = await db.tasks.get(task.id);
      if (!current) return;
      if (current.completedAt) {
        const was = current.completedAt;
        await updateTask(current.id, { completedAt: undefined });
        this.offerUndo(`Reopened ${current.name}`, () => updateTask(current.id, { completedAt: was }));
      } else {
        await updateTask(current.id, { completedAt: Date.now() });
        this.offerUndo(`Completed ${current.name}`, () => updateTask(current.id, { completedAt: undefined }));
      }
    } catch (err) {
      this.error = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
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
