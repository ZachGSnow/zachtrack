import { addFast, getActiveFast, updateFast, type FastRecord } from '../db';
import { getZoneForHour, type BioZone } from '../data/zones';
import type { FastPreset } from '../data/presets';
import { elapsedHours } from '../utils/time';
import { scheduleZoneMilestones } from '../utils/notifications';
import { settingsStore } from './settings.svelte';

function maybeScheduleMilestones(startTime: number): (() => void) | null {
  return settingsStore.data.notificationsEnabled ? scheduleZoneMilestones(startTime) : null;
}

class FastTimerStore {
  activeFast = $state<FastRecord | null>(null);
  now = $state(Date.now());
  ready = $state(false);

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private cancelMilestones: (() => void) | null = null;

  elapsedMs = $derived(this.activeFast ? this.now - this.activeFast.startTime : 0);
  elapsedHrs = $derived(this.activeFast ? elapsedHours(this.activeFast.startTime, this.now) : 0);
  zone = $derived<BioZone>(getZoneForHour(this.elapsedHrs));
  progressToTarget = $derived(
    this.activeFast?.targetHours ? Math.min(1, this.elapsedHrs / this.activeFast.targetHours) : null,
  );

  async init() {
    const existing = await getActiveFast();
    this.activeFast = existing ?? null;
    if (existing) {
      this.startTicking();
      this.cancelMilestones = maybeScheduleMilestones(existing.startTime);
    }
    this.ready = true;
  }

  /** Re-syncs `activeFast` from the DB - call after an external edit (e.g. from History). */
  async refreshActive() {
    const existing = await getActiveFast();
    this.cancelMilestones?.();
    this.cancelMilestones = null;
    this.activeFast = existing ?? null;
    if (existing) {
      this.startTicking();
      this.cancelMilestones = maybeScheduleMilestones(existing.startTime);
    } else {
      this.stopTicking();
    }
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
    this.startTicking();
    this.cancelMilestones = maybeScheduleMilestones(startTime);
  }

  async stop(details?: { moodRating?: number; energyRating?: number; hungerRating?: number; tags?: string[]; note?: string }) {
    if (!this.activeFast?.id) return;
    const endTime = Date.now();
    await updateFast(this.activeFast.id, {
      endTime,
      ...details,
    });
    this.stopTicking();
    this.cancelMilestones?.();
    this.cancelMilestones = null;
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
