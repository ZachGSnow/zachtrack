<script lang="ts">
  import { updateTrackable } from '../db';
  import type { LapsedHabit } from '../utils/today';
  import { addDays, startOfDay } from '../utils/time';
  import Button from './ui/Button.svelte';

  // A habit that was going well and has stopped (utils/today.ts lapsedHabits):
  // three gentle ways on, instead of a streak quietly reading zero.
  let { lapsed, onDismiss }: { lapsed: LapsedHabit; onDismiss: () => void } = $props();

  const t = $derived(lapsed.habit.trackable);
  const unit = $derived(t.goalType === 'perDay' ? (lapsed.lowerTo === 1 ? 'once a day' : `${lapsed.lowerTo} times a day`) : `${lapsed.lowerTo} a day`);

  async function pauseWeek() {
    await updateTrackable(t.id, { pausedUntil: addDays(startOfDay(Date.now()), 6) });
  }
  async function lower() {
    if (lapsed.lowerTo) await updateTrackable(t.id, { goalValue: lapsed.lowerTo });
  }
</script>

<section class="rounded-2xl border border-warn/35 bg-warn-soft p-3" aria-label="{t.name} has slipped">
  <p class="text-sm text-text">
    <span aria-hidden="true">{t.icon}</span>
    <strong>{t.name}</strong> has slipped this week, after {lapsed.before.met} of {lapsed.before.of} days before. That happens; pick a way back.
  </p>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <Button size="sm" onclick={pauseWeek}>Pause a week</Button>
    {#if lapsed.lowerTo}
      <Button size="sm" onclick={lower}>Make it {unit}</Button>
    {/if}
    <button class="text-xs text-text-muted" onclick={onDismiss}>Start again</button>
  </div>
</section>
