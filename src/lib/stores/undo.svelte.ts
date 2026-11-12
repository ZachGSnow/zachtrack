/**
 * The one "... Undo" message at the bottom of the screen (UndoToast.svelte,
 * mounted once in App.svelte). Logging a habit, completing or moving a task,
 * and anything else that can be taken back for a few seconds offer it here, so
 * two never stack in the same place: a newer one replaces the older, whose
 * change simply stays.
 */
export const UNDO_MS = 6000;

class UndoStore {
  current = $state<{ message: string; revert: () => Promise<unknown> } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  offer(message: string, revert: () => Promise<unknown>) {
    clearTimeout(this.timer);
    this.current = { message, revert };
    this.timer = setTimeout(() => (this.current = null), UNDO_MS);
  }

  async undo() {
    if (!this.current) return;
    const { revert } = this.current;
    this.current = null;
    clearTimeout(this.timer);
    await revert();
  }
}

export const undoToast = new UndoStore();
