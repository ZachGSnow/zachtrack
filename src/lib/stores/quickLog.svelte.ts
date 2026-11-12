import { addTrackableEntry, deleteTrackableEntry, type TrackableDefinition, type TrackableEntry } from '../db';
import { formatShortDate, startOfDay } from '../utils/time';
import { undoToast } from './undo.svelte';

/**
 * Logging from a list: the "+" and check buttons on Trackables and Today, and
 * the day cells of Today's habit matrix. A trackable with fields (or dates)
 * opens the Log entry sheet; one without logs right away, the "I just did it"
 * of a days-since app, and checking it again takes the entry back off. Either
 * way there are a few seconds to undo (stores/undo.svelte.ts). QuickLogHost.svelte
 * renders the sheet and errors.
 */
class QuickLogStore {
  sheetOpen = $state(false);
  sheetTrackable = $state<TrackableDefinition | null>(null);
  /** When the sheet's new entry starts out: a day picked in the matrix; undefined = now. */
  sheetTimestamp = $state<number | undefined>(undefined);
  error = $state('');

  private offerUndo(message: string, revert: () => Promise<unknown>) {
    undoToast.offer(message, revert);
  }

  /** Opens the sheet, or logs a trackable without fields right away. */
  async log(t: TrackableDefinition) {
    await this.logOn(t, Date.now());
  }

  /** The same for a given moment: an earlier day's noon from the matrix. */
  async logOn(t: TrackableDefinition, timestamp: number) {
    if (t.fieldIds.length > 0 || t.displayMode === 'ages') {
      this.sheetTrackable = t;
      this.sheetTimestamp = startOfDay(timestamp) === startOfDay(Date.now()) ? undefined : timestamp;
      this.sheetOpen = true;
      return;
    }
    this.error = '';
    try {
      const entry = await addTrackableEntry({ trackableId: t.id, timestamp });
      const when = startOfDay(timestamp) === startOfDay(Date.now()) ? '' : ` for ${formatShortDate(timestamp)}`;
      this.offerUndo(`Logged ${t.name}${when}`, () => deleteTrackableEntry(entry.id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not log it. Please try again.';
    }
  }

  /** Logs an entry with these values now, with undo: the water button during a long fast. */
  async logValues(t: TrackableDefinition, values: Record<string, number>, message: string) {
    this.error = '';
    try {
      const entry = await addTrackableEntry({ trackableId: t.id, timestamp: Date.now(), values });
      this.offerUndo(message, () => deleteTrackableEntry(entry.id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not log it. Please try again.';
    }
  }

  /** Unchecks today: removes today's latest entry; Undo puts it back. */
  async uncheck(t: TrackableDefinition, entries: readonly TrackableEntry[]) {
    await this.uncheckOn(t, entries, Date.now());
  }

  /** Removes the latest entry on `day`'s date; Undo puts it back. */
  async uncheckOn(t: TrackableDefinition, entries: readonly TrackableEntry[], day: number) {
    const target = startOfDay(day);
    const latest = entries.filter((e) => startOfDay(e.timestamp) === target).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!latest) return;
    this.error = '';
    try {
      await deleteTrackableEntry(latest.id);
      const { timestamp, note, tags, values } = latest;
      const when = target === startOfDay(Date.now()) ? '' : ` for ${formatShortDate(target)}`;
      this.offerUndo(`Unchecked ${t.name}${when}`, () => addTrackableEntry({ trackableId: t.id, timestamp, note, tags, values }));
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not uncheck it. Please try again.';
    }
  }

  /** A tap on the check button: logs, or on a done day without fields, unchecks. */
  async toggle(t: TrackableDefinition, entries: readonly TrackableEntry[], doneToday: boolean) {
    if (t.fieldIds.length === 0 && doneToday) await this.uncheck(t, entries);
    else await this.log(t);
  }

  /**
   * A tap on a day cell: a trackable with fields opens the sheet for that day;
   * one without logs it (today: now, an earlier day: midday, so it lands on
   * that date whatever the time zone does), or takes a logged day back off.
   */
  async toggleOn(t: TrackableDefinition, entries: readonly TrackableEntry[], day: number) {
    const target = startOfDay(day);
    const isToday = target === startOfDay(Date.now());
    const at = isToday ? Date.now() : target + 12 * 3600 * 1000;
    if (t.fieldIds.length > 0 || t.displayMode === 'ages') return this.logOn(t, at);
    const logged = entries.some((e) => startOfDay(e.timestamp) === target);
    if (logged) await this.uncheckOn(t, entries, target);
    else await this.logOn(t, at);
  }
}

export const quickLog = new QuickLogStore();
