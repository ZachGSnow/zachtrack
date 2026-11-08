<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { liveQuery } from 'dexie';
  import { db, DuplicateStartDayError } from '../db';
  import { fastTimer } from '../stores/fast.svelte';
  import { settingsStore } from '../stores/settings.svelte';
  import { allPresets } from '../data/presets';
  import { planForDay, scheduleStatus } from '../utils/fastingSchedule';
  import { eatingWindowStatus } from '../utils/fastingJourney';
  import { fastTimeline } from '../utils/fastProgress';
  import { addDays, formatDuration, startOfDay } from '../utils/time';
  import Card from './ui/Card.svelte';
  import Button from './ui/Button.svelte';
  import { readableText } from '../utils/color';
  import { themeStore } from '../stores/theme.svelte';

  // Today's fasting block: the running fast at a glance, or, between fasts,
  // the eating window and the schedule with one tap to start today's method.
  // Everything else (starting earlier, ending, details) stays on the timer.
  let { now }: { now: number } = $props();

  // A fast can run past a day, so the eating window looks a few days back for the last one that ended.
  const recentFasts = liveQuery(() => db.fasts.where('startDay').aboveOrEqual(addDays(startOfDay(Date.now()), -3)).toArray());
  const active = $derived(fastTimer.activeFast);
  const schedule = $derived(active ? null : scheduleStatus(settingsStore.data, $recentFasts ?? [], now));
  const eating = $derived(active ? null : eatingWindowStatus($recentFasts ?? [], now));
  const plan = $derived(planForDay(settingsStore.data, startOfDay(now)));
  // Today's method from the weekly plan, else the default.
  const preset = $derived(
    allPresets(settingsStore.data.customFastPresets).find((p) => p.id === (plan.presetId ?? settingsStore.data.defaultPresetId)),
  );
  const timeline = $derived(active ? fastTimeline(active, Math.max(now, fastTimer.now)) : null);

  let error = $state('');
  async function start() {
    if (!preset) return;
    error = '';
    try {
      await fastTimer.start(preset);
    } catch (e) {
      error = e instanceof DuplicateStartDayError ? e.message : 'Could not start the fast. Please try again.';
    }
  }
</script>

<Card label="Fasting" padding="p-4">
  {#if !fastTimer.ready}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if active}
    <div class="flex items-baseline justify-between gap-2">
      <p class="text-xs font-semibold tracking-wide text-text-muted uppercase">Fasting &middot; {active.presetLabel ?? 'Count-up'}</p>
      <a href="/fasting" use:link class="text-xs font-semibold text-brand">Open timer</a>
    </div>
    <p class="mt-1 font-heading text-3xl font-semibold text-text">{formatDuration(fastTimer.elapsedMs)}</p>
    {#if fastTimer.progressToTarget != null}
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Progress to goal" aria-valuenow={Math.round(fastTimer.progressToTarget * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div class="h-full rounded-full transition-[width]" style="width: {fastTimer.progressToTarget * 100}%; background: {fastTimer.zone.color};"></div>
      </div>
    {/if}
    <p class="mt-2 text-sm text-text">{fastTimer.zone.title}</p>
    {#if timeline?.goal}<p class="text-xs text-text-muted">{timeline.goal}</p>{/if}
    {#if fastTimer.milestone}
      <p class="mt-2 text-xs font-medium" style="color: {readableText(fastTimer.zone.color, themeStore.effective)};">{fastTimer.milestone.title}</p>
    {/if}
  {:else}
    <div class="flex items-baseline justify-between gap-2">
      <p class="text-xs font-semibold tracking-wide text-text-muted uppercase">Fasting</p>
      <a href="/fasting" use:link class="text-xs font-semibold text-brand">More options</a>
    </div>
    <div class="mt-1 flex flex-col gap-0.5 text-sm">
      {#if eating?.text}
        <p class={eating.open ? 'text-text' : 'text-text-muted'}>{eating.text}</p>
      {/if}
      {#if eating}
        <p class="text-xs text-text-muted">{eating.lastFast}</p>
      {/if}
      {#if plan.rest}
        <p class="text-text-muted">A rest day in your weekly plan.</p>
      {:else if schedule}
        <p class={schedule.late ? 'font-medium text-warn' : 'text-text-muted'}>{schedule.text}</p>
      {:else if !eating}
        <p class="text-text-muted">No fast running.</p>
      {/if}
    </div>
    {#if preset}
      <div class="mt-3">
        <Button variant="primary" onclick={start}>Start {preset.label}</Button>
      </div>
    {/if}
    {#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
  {/if}
</Card>
