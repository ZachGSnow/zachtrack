import { liveQuery, type Subscription } from 'dexie';
import { addFast, getActiveFast, updateFast, type FastRecord } from '../db';
import { getZoneForHour, type BioZone } from '../data/zones';
import type { FastPreset } from '../data/presets';
import { elapsedHours } from '../utils/time';
import { latestMilestone, type Milestone } from '../utils/fastProgress';

/** The last milestone banner dismissed on this device (utils/fastProgress.ts key). */
const MILESTONE_SEEN_KEY = 'zachtrack:milestone-seen';

function loadSeenMilestone(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(MILESTONE_SEEN_KEY);
  } catch {
    return null;
  }
}

class FastTimerStore {
  activeFast = $state<FastRecord | null>(null);
  now = $state(Date.now());
  ready = $state(false);

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private subscription: Subscription | undefined;
  /** Key of the last milestone banner dismissed here; see `milestone`. */
  private seenMilestone = $state<string | null>(loadSeenMilestone());

  elapsedMs = $derived(this.activeFast ? this.now - this.activeFast.startTime : 0);
  elapsedHrs = $derived(this.activeFast ? elapsedHours(this.activeFast.startTime, this.now) : 0);
  zone = $derived<BioZone>(getZoneForHour(this.elapsedHrs));
  progressToTarget = $derived(
    this.activeFast?.targetHours ? Math.min(1, this.elapsedHrs / this.activeFast.targetHours) : null,
  );
  /**
   * In-app milestones instead of notifications: the latest zone or goal the
   * running fast has reached, until it's dismissed. Shown as a banner on the
   * Fasting tab and a dot on its nav item.
   */
  milestone = $derived.by<Milestone | null>(() => {
    if (!this.activeFast) return null;
    const m = latestMilestone(this.activeFast, this.now);
    return m && m.key !== this.seenMilestone ? m : null;
  });

  dismissMilestone() {
    const key = this.milestone?.key;
    if (!key) return;
    this.seenMilestone = key;
    try {
      localStorage.setItem(MILESTONE_SEEN_KEY, key);
    } catch {
      // Not persisted: it shows again after a reload, nothing worse.
    }
  }

  async init() {
    this.apply(await getActiveFast());
    this.ready = true;
    // A fast can also start or end without a tap on this device: a sync pull
    // from another device or an import writes it straight to IndexedDB. Follow
    // the table with liveQuery like every other screen, so the timer shows a
    // fast started elsewhere, and stops showing one ended elsewhere (ending it
    // again here would overwrite the other device's end time).
    this.subscription ??= liveQuery(() => getActiveFast()).subscribe({
      next: (existing) => this.apply(existing),
    });
  }

  /** Re-syncs `activeFast` from the DB - call after an external edit (e.g. from History). */
  async refreshActive() {
    this.apply(await getActiveFast());
  }

  /** Shows `existing` as the running fast (or none), restarting the ticking only when the fast itself changed. */
  private apply(existing: FastRecord | undefined) {
    const previous = this.activeFast;
    this.activeFast = existing ?? null;
    if (existing && previous && previous.uuid === existing.uuid && previous.startTime === existing.startTime) {
      return; // Same fast, e.g. a note or tag edit: keep the timer as it is.
    }
    if (existing) this.startTicking();
    else this.stopTicking();
  }

  async start(preset: FastPreset, startTime: number = Date.now()) {
    if (this.activeFast) return;
    const created = await addFast({
      startTime,
      method: preset.id === 'custom' ? 'custom' : 'preset',
      presetId: preset.id,
      presetLabel: preset.label,
      targetHours: preset.targetHours,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.activeFast = created;
    this.now = Date.now();
    this.startTicking();
  }

  /** Switches the running fast to another method or length; the start time stays. */
  async changeGoal(preset: FastPreset) {
    if (!this.activeFast?.id) return;
    await updateFast(this.activeFast.id, {
      method: preset.id === 'custom' ? 'custom' : 'preset',
      presetId: preset.id,
      presetLabel: preset.label,
      targetHours: preset.targetHours,
    });
    await this.refreshActive();
  }

  async stop(details?: { moodRating?: number; energyRating?: number; hungerRating?: number; tags?: string[]; note?: string }) {
    if (!this.activeFast?.id) return;
    const endTime = Date.now();
    await updateFast(this.activeFast.id, {
      endTime,
      ...details,
    });
    this.stopTicking();
    this.activeFast = null;
  }

  private startTicking() {
    this.stopTicking();
    this.tickHandle = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }

  private stopTicking() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }
}

export const fastTimer = new FastTimerStore();
