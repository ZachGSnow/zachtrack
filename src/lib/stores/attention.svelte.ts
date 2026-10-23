import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db';
import { addDays, startOfDay } from '../utils/time';
import { attentionItems, type AttentionItem, type Snapshot } from '../utils/attention';
import { scheduleStatus } from '../utils/fastingSchedule';

/**
 * In-app reminders instead of notifications: what needs attention right now,
 * for the "Needs attention" panel on Trackables and the badges on the nav.
 * Recomputed when the data changes and once a minute as time passes.
 */

class AttentionStore {
  items = $state<AttentionItem[]>([]);
  /** The daily fasting schedule's start has passed with no fast started today. */
  fastingLate = $state(false);

  private snapshot: Snapshot | null = null;
  private subscription: Subscription | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  init() {
    this.subscription ??= liveQuery(async (): Promise<Snapshot> => ({
      trackables: await db.trackableDefinitions.toArray(),
      fields: await db.fieldDefinitions.toArray(),
      entries: await db.trackableEntries.toArray(),
      recentFasts: await db.fasts.where('startDay').aboveOrEqual(addDays(startOfDay(Date.now()), -1)).toArray(),
      scheduleTime: await db.settings.get('app-settings'),
    })).subscribe({
      next: (snapshot) => {
        this.snapshot = snapshot;
        this.refresh();
      },
    });
    this.timer ??= setInterval(() => this.refresh(), 60_000);
  }

  private refresh() {
    if (!this.snapshot) return;
    const now = Date.now();
    this.items = attentionItems(this.snapshot, now);
    const running = this.snapshot.recentFasts.some((f) => f.endTime == null && f.startTime <= now);
    this.fastingLate = !running && !!scheduleStatus(this.snapshot.scheduleTime, this.snapshot.recentFasts, now)?.late;
  }
}

export const attentionStore = new AttentionStore();
