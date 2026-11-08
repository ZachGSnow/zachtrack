import { addTrackableEntry, deleteTrackableEntry, type TrackableDefinition, type TrackableEntry } from '../db';
import { startOfDay } from '../utils/time';

/**
 * Logging from a list: the "+" and check buttons on Trackables and Today. A
 * trackable with fields (or dates) opens the Log entry sheet; one without
 * logs right away, the "I just did it" of a days-since app, and checking it
 * again takes today's entry back off. Either way there are a few seconds to
 * undo. QuickLogHost.svelte renders the sheet, the undo toast and errors.
 */
class QuickLogStore {
  sheetOpen = $state(false);
  sheetTrackable = $state<TrackableDefinition | null>(null);
  undo = $state<{ message: string; revert: () => Promise<unknown> } | null>(null);
  error = $state('');

  private undoTimer: ReturnType<typeof setTimeout> | undefined;

  private offerUndo(message: string, revert: () => Promise<unknown>) {
    clearTimeout(this.undoTimer);
    this.undo = { message, revert };
    this.undoTimer = setTimeout(() => (this.undo = null), 6000);
  }

  /** Opens the sheet, or logs a trackable without fields right away. */
  async log(t: TrackableDefinition) {
    if (t.fieldIds.length > 0 || t.displayMode === 'ages') {
      this.sheetTrackable = t;
      this.sheetOpen = true;
      return;
    }
    this.error = '';
    try {
      const entry = await addTrackableEntry({ trackableId: t.id, timestamp: Date.now() });
      this.offerUndo(`Logged ${t.name}`, () => deleteTrackableEntry(entry.id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not log it. Please try again.';
    }
  }

  /** Unchecks today: removes today's latest entry; Undo puts it back. */
  async uncheck(t: TrackableDefinition, entries: readonly TrackableEntry[]) {
    const today = startOfDay(Date.now());
    const latest = entries.filter((e) => startOfDay(e.timestamp) === today).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!latest) return;
    this.error = '';
    try {
      await deleteTrackableEntry(latest.id);
      const { timestamp, note, tags, values } = latest;
      this.offerUndo(`Unchecked ${t.name}`, () => addTrackableEntry({ trackableId: t.id, timestamp, note, tags, values }));
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not uncheck it. Please try again.';
    }
  }

  /** A tap on the check button: logs, or on a done day without fields, unchecks. */
  async toggle(t: TrackableDefinition, entries: readonly TrackableEntry[], doneToday: boolean) {
    if (t.fieldIds.length === 0 && doneToday) await this.uncheck(t, entries);
    else await this.log(t);
  }

  async undoNow() {
    if (!this.undo) return;
    const { revert } = this.undo;
    this.undo = null;
    clearTimeout(this.undoTimer);
    await revert();
  }
}

export const quickLog = new QuickLogStore();
