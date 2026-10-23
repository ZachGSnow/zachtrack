<script lang="ts">
  import { fastTimer } from '../lib/stores/fast.svelte';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { PRESETS, DEFAULT_PRESET_ID } from '../lib/data/presets';
  import TimerRing from '../lib/components/TimerRing.svelte';
  import ZoneCard from '../lib/components/ZoneCard.svelte';
  import MethodPicker from '../lib/components/MethodPicker.svelte';
  import { requestNotificationPermission } from '../lib/utils/notifications';
  import { DuplicateStartDayError } from '../lib/db';
  import TagInput from '../lib/components/TagInput.svelte';
  import ZoneReferenceList from '../lib/components/ZoneReferenceList.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditFastSheet from '../lib/components/EditFastSheet.svelte';
  import { takeShortcut } from '../lib/utils/shortcuts';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { addDays, startOfDay } from '../lib/utils/time';
  import { eatingWindowText, scheduleStatus } from '../lib/utils/fastingSchedule';

  // The schedule countdown and eating-window line change with the clock, also while no fast runs.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  const recentFasts = liveQuery(() => db.fasts.where('startDay').aboveOrEqual(addDays(startOfDay(Date.now()), -1)).toArray());
  const schedule = $derived(fastTimer.activeFast ? null : scheduleStatus(settingsStore.data.fastScheduleTime, $recentFasts ?? [], now));
  const eatingWindow = $derived(fastTimer.activeFast ? eatingWindowText(fastTimer.activeFast, now) : null);

  let selectedPresetId = $state(DEFAULT_PRESET_ID);
  let presetInitialized = false;
  $effect(() => {
    if (!presetInitialized && settingsStore.ready) {
      selectedPresetId = settingsStore.data.defaultPresetId;
      presetInitialized = true;
    }
  });

  let showStopPanel = $state(false);
  let moodRating = $state<number | null>(null);
  let energyRating = $state<number | null>(null);
  let hungerRating = $state<number | null>(null);
  let tags = $state<string[]>([]);
  let note = $state('');
  let startError = $state('');
  let finishError = $state('');
  let editActiveOpen = $state(false);

  async function handleStart() {
    startError = '';
    const preset = PRESETS.find((p) => p.id === selectedPresetId) ?? PRESETS[0];
    if (settingsStore.data.notificationsEnabled) {
      await requestNotificationPermission();
    }
    try {
      await fastTimer.start(preset);
    } catch (e) {
      startError =
        e instanceof DuplicateStartDayError
          ? e.message
          : 'Something went wrong starting your fast. Please try again.';
    }
  }

  // The "Start fast" home-screen shortcut starts the default method once the
  // running fast (if any) and the settings have loaded; with a fast already
  // running it just shows it.
  let shortcutChecked = false;
  $effect(() => {
    if (shortcutChecked || !fastTimer.ready || !settingsStore.ready) return;
    shortcutChecked = true;
    if (takeShortcut('start-fast') && !fastTimer.activeFast) void handleStart();
  });

  async function handleFinish() {
    finishError = '';
    try {
      await fastTimer.stop({
        moodRating: moodRating ?? undefined,
        energyRating: energyRating ?? undefined,
        hungerRating: hungerRating ?? undefined,
        tags: tags.length ? [...tags] : undefined,
        note: note.trim() || undefined,
      });
      showStopPanel = false;
      moodRating = null;
      energyRating = null;
      hungerRating = null;
      tags = [];
      note = '';
    } catch (e) {
      finishError = e instanceof Error ? e.message : 'Something went wrong finishing your fast. Please try again.';
    }
  }
</script>

<div class="flex flex-1 flex-col items-center gap-6 px-5 py-8">
  {#if !fastTimer.ready}
    <p class="mt-20 text-text-muted">Loading&hellip;</p>
  {:else if fastTimer.activeFast}
    <TimerRing
      elapsedMs={fastTimer.elapsedMs}
      elapsedHrs={fastTimer.elapsedHrs}
      targetHours={fastTimer.activeFast.targetHours}
      progress={fastTimer.progressToTarget}
      color={fastTimer.zone.color}
      onTimeClick={() => (editActiveOpen = true)}
    />

    {#if fastTimer.activeFast.presetLabel}
      <p class="-mt-4 text-sm text-text-muted">Fasting method: {fastTimer.activeFast.presetLabel}</p>
    {/if}
    {#if eatingWindow}
      <p class="-mt-4 text-sm text-text-muted">{eatingWindow}</p>
    {/if}

    <ZoneCard zone={fastTimer.zone} />

    {#if !showStopPanel}
      <button
        class="w-full rounded-xl border py-3 text-base font-semibold"
        style="border-color: #ef444460; color: #f87171; background: #ef444414;"
        onclick={() => (showStopPanel = true)}
      >
        End Fast
      </button>
    {:else}
      <div class="w-full space-y-4 rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
        <div>
          <p class="mb-1.5 text-sm font-medium text-text-muted">How do you feel?</p>
          <div class="flex gap-2">
            {#each [1, 2, 3, 4, 5] as n (n)}
              <button
                class="flex-1 rounded-lg border py-2 text-sm"
                style={moodRating === n
                  ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                  : 'border-color: var(--color-border); color: var(--color-text-muted);'}
                onclick={() => (moodRating = n)}
              >{n}</button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-sm font-medium text-text-muted">Energy level?</p>
          <div class="flex gap-2">
            {#each [1, 2, 3, 4, 5] as n (n)}
              <button
                class="flex-1 rounded-lg border py-2 text-sm"
                style={energyRating === n
                  ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                  : 'border-color: var(--color-border); color: var(--color-text-muted);'}
                onclick={() => (energyRating = n)}
              >{n}</button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-sm font-medium text-text-muted">Hunger level?</p>
          <div class="flex gap-2">
            {#each [1, 2, 3, 4, 5] as n (n)}
              <button
                class="flex-1 rounded-lg border py-2 text-sm"
                style={hungerRating === n
                  ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                  : 'border-color: var(--color-border); color: var(--color-text-muted);'}
                onclick={() => (hungerRating = n)}
              >{n}</button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-sm font-medium text-text-muted">Tags</p>
          <TagInput bind:tags />
        </div>
        <textarea
          bind:value={note}
          placeholder="Notes (optional)"
          rows="2"
          class="w-full resize-none rounded-lg border bg-transparent p-2 text-sm text-text placeholder:text-text-muted"
          style="border-color: var(--color-border);"
        ></textarea>
        {#if finishError}
          <p class="text-sm" style="color: #f87171;">{finishError}</p>
        {/if}
        <div class="flex gap-2">
          <button
            class="flex-1 rounded-xl border py-2.5 text-sm font-medium text-text-muted"
            style="border-color: var(--color-border);"
            onclick={() => (showStopPanel = false)}
          >Cancel</button>
          <button
            class="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style="background: var(--color-brand); color: #06140c;"
            onclick={handleFinish}
          >Save & Finish</button>
        </div>
      </div>
    {/if}
  {:else}
    <div class="mt-6 flex flex-col items-center gap-2 text-center">
      <span class="text-5xl">&#x2744;&#xFE0F;</span>
      <h1 class="text-2xl font-semibold text-text">Ready when you are</h1>
      <p class="text-sm text-text-muted">Pick a method and start your fast.</p>
      {#if schedule}
        <p class="text-sm font-medium" style="color: {schedule.late ? '#fbbf24' : 'var(--color-text-muted)'};">{schedule.text}</p>
      {/if}
    </div>

    <MethodPicker bind:selectedId={selectedPresetId} />

    {#if startError}
      <p class="text-sm" style="color: #f87171;">{startError}</p>
    {/if}

    <button
      class="w-full rounded-xl py-3.5 text-base font-semibold"
      style="background: var(--color-brand); color: #06140c;"
      onclick={handleStart}
    >
      Start Fast
    </button>
  {/if}

  <ZoneReferenceList currentZoneId={fastTimer.activeFast ? fastTimer.zone.id : null} />
</div>

<BottomSheet bind:open={editActiveOpen}>
  <EditFastSheet bind:open={editActiveOpen} fast={fastTimer.activeFast} />
</BottomSheet>
