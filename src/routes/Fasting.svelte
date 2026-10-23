<script lang="ts">
  import { fastTimer } from '../lib/stores/fast.svelte';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { allPresets, DEFAULT_PRESET_ID } from '../lib/data/presets';
  import TimerRing from '../lib/components/TimerRing.svelte';
  import ZoneCard from '../lib/components/ZoneCard.svelte';
  import MethodPicker from '../lib/components/MethodPicker.svelte';
  import { DuplicateStartDayError } from '../lib/db';
  import TagInput from '../lib/components/TagInput.svelte';
  import ZoneReferenceList from '../lib/components/ZoneReferenceList.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditFastSheet from '../lib/components/EditFastSheet.svelte';
  import { takeShortcut } from '../lib/utils/shortcuts';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { addDays, fromDatetimeLocal, startOfDay, toDatetimeLocal } from '../lib/utils/time';
  import { planForDay, scheduleStatus } from '../lib/utils/fastingSchedule';
  import { endSummary, fastTimeline, longFastGuidance, refeedingNote, startedAgo } from '../lib/utils/fastProgress';
  import { eatingWindowStatus } from '../lib/utils/fastingJourney';

  // The schedule countdown and the timeline lines change with the clock, also while no fast runs.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  const recentFasts = liveQuery(() => db.fasts.where('startDay').aboveOrEqual(addDays(startOfDay(Date.now()), -1)).toArray());
  const schedule = $derived(fastTimer.activeFast ? null : scheduleStatus(settingsStore.data, $recentFasts ?? [], now));
  // A fast can run past a day, so the eating window looks a few days back for the last one that ended.
  const lastFasts = liveQuery(() => db.fasts.where('startDay').aboveOrEqual(addDays(startOfDay(Date.now()), -3)).toArray());
  const eatingWindow = $derived(fastTimer.activeFast ? null : eatingWindowStatus($lastFasts ?? [], now));
  const timeline = $derived(fastTimer.activeFast ? fastTimeline(fastTimer.activeFast, Math.max(now, fastTimer.now)) : null);

  let selectedPresetId = $state(DEFAULT_PRESET_ID);
  let presetInitialized = false;
  $effect(() => {
    if (!presetInitialized && settingsStore.ready) {
      // Today's method from the weekly plan, else the default.
      selectedPresetId = planForDay(settingsStore.data, startOfDay(Date.now())).presetId ?? settingsStore.data.defaultPresetId;
      presetInitialized = true;
    }
  });

  // "Started earlier": for a fast you forgot to start. Minutes ago, or a time you pick.
  const EARLIER = [
    { id: 'now', label: 'Now', minutes: 0 },
    { id: '30', label: '30m ago', minutes: 30 },
    { id: '60', label: '1h ago', minutes: 60 },
    { id: '120', label: '2h ago', minutes: 120 },
  ];
  let startedChoice = $state<string>('now');
  let pickedStart = $state('');

  let showStopPanel = $state(false);
  let showDetails = $state(false);
  let moodRating = $state<number | null>(null);
  let energyRating = $state<number | null>(null);
  let hungerRating = $state<number | null>(null);
  let tags = $state<string[]>([]);
  let note = $state('');
  let startError = $state('');
  let finishError = $state('');
  let editActiveOpen = $state(false);
  let changeGoalOpen = $state(false);
  let goalPresetId = $state(DEFAULT_PRESET_ID);
  let goalError = $state('');

  const summary = $derived(showStopPanel && fastTimer.activeFast ? endSummary(fastTimer.activeFast, fastTimer.now) : null);
  const guidance = $derived(fastTimer.activeFast ? longFastGuidance(fastTimer.activeFast, fastTimer.now) : []);
  const refeeding = $derived(showStopPanel ? refeedingNote(fastTimer.elapsedHrs) : null);

  function chosenStart(): number | string {
    if (startedChoice === 'pick') {
      const t = fromDatetimeLocal(pickedStart);
      if (!pickedStart || Number.isNaN(t)) return 'Pick when the fast started.';
      if (t > Date.now()) return 'The start time cannot be in the future.';
      return t;
    }
    return startedAgo(EARLIER.find((e) => e.id === startedChoice)?.minutes ?? 0, Date.now());
  }

  async function handleStart() {
    startError = '';
    const presets = allPresets(settingsStore.data.customFastPresets);
    const preset = presets.find((p) => p.id === selectedPresetId) ?? presets[0];
    const start = chosenStart();
    if (typeof start === 'string') {
      startError = start;
      return;
    }
    try {
      await fastTimer.start(preset, start);
      startedChoice = 'now';
      pickedStart = '';
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

  function openChangeGoal() {
    goalPresetId = fastTimer.activeFast?.presetId ?? DEFAULT_PRESET_ID;
    goalError = '';
    changeGoalOpen = true;
  }

  async function saveGoal() {
    const preset = allPresets(settingsStore.data.customFastPresets).find((p) => p.id === goalPresetId);
    if (!preset) return;
    try {
      await fastTimer.changeGoal(preset);
      changeGoalOpen = false;
    } catch (e) {
      goalError = e instanceof Error ? e.message : 'Could not change the goal. Please try again.';
    }
  }

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
      showDetails = false;
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

{#snippet rating(label: string, value: number | null, set: (n: number | null) => void)}
  <div>
    <p class="mb-1.5 text-sm font-medium text-text-muted">{label}</p>
    <div class="flex gap-2" role="group" aria-label={label}>
      {#each [1, 2, 3, 4, 5] as n (n)}
        <button
          class="flex-1 rounded-lg border py-2 text-sm"
          aria-pressed={value === n}
          style={value === n
            ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
            : 'border-color: var(--color-border); color: var(--color-text-muted);'}
          onclick={() => set(value === n ? null : n)}
        >{n}</button>
      {/each}
    </div>
  </div>
{/snippet}

<!-- One column on a phone; on a laptop the timer sits beside the zone reference. -->
<div class="mx-auto flex w-full flex-1 flex-col items-center gap-6 px-5 py-8 lg:grid lg:max-w-6xl lg:grid-cols-2 lg:items-start lg:gap-10">
  <div class="flex w-full flex-col items-center gap-6">
    {#if !fastTimer.ready}
      <p class="mt-20 text-text-muted">Loading&hellip;</p>
    {:else if fastTimer.activeFast}
      {#if fastTimer.milestone}
        <div
          role="status"
          class="flex w-full items-start gap-3 rounded-2xl border p-3"
          style="border-color: {fastTimer.zone.color}80; background: {fastTimer.zone.color}14;"
        >
          <div class="flex-1">
            <p class="text-sm font-semibold text-text">{fastTimer.milestone.title}</p>
            <p class="text-xs text-text-muted">{fastTimer.milestone.text}</p>
          </div>
          <button class="text-sm text-text-muted" aria-label="Dismiss milestone" onclick={() => fastTimer.dismissMilestone()}>&times;</button>
        </div>
      {/if}

      <TimerRing
        elapsedMs={fastTimer.elapsedMs}
        elapsedHrs={fastTimer.elapsedHrs}
        targetHours={fastTimer.activeFast.targetHours}
        progress={fastTimer.progressToTarget}
        color={fastTimer.zone.color}
        onTimeClick={() => (editActiveOpen = true)}
      />

      <div class="relative z-10 -mt-2 flex flex-col items-center gap-0.5 text-center text-sm text-text-muted">
        <p>
          {fastTimer.activeFast.presetLabel ?? 'Count-up fast'}
          <button class="ml-1 text-xs font-semibold underline" style="color: var(--color-brand);" onclick={openChangeGoal}>Change goal</button>
        </p>
        {#if timeline}
          <p>{timeline.started}</p>
          {#if timeline.goal}<p>{timeline.goal}</p>{/if}
          {#if timeline.next}<p class="text-xs">Next: {timeline.next}</p>{/if}
        {/if}
      </div>

      <ZoneCard zone={fastTimer.zone} />

      {#if guidance.length}
        <section class="w-full rounded-2xl border p-4 text-sm" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="long-fast">
          <h2 id="long-fast" class="mb-1 font-semibold text-text">Long fast</h2>
          <ul class="flex list-disc flex-col gap-1 pl-5 text-text-muted">
            {#each guidance as line (line)}<li>{line}</li>{/each}
          </ul>
          <p class="mt-2 text-xs text-text-muted">General information, not medical advice.</p>
        </section>
      {/if}

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
          {#if summary}
            <div aria-label="Fast summary">
              <p class="text-lg font-semibold text-text">{summary.duration}</p>
              {#if summary.goal}
                <p class="text-sm font-medium" style="color: {summary.goalMet ? 'var(--color-brand)' : '#fbbf24'};">{summary.goal}</p>
              {/if}
              <p class="text-xs text-text-muted">Reached: {summary.zone}</p>
              {#if refeeding}
                <p class="mt-2 text-xs text-text-muted">{refeeding} General information, not medical advice.</p>
              {/if}
            </div>
          {/if}

          {#if !showDetails}
            <button class="text-sm font-medium underline" style="color: var(--color-brand);" onclick={() => (showDetails = true)}
              >Add details: how you feel, tags, note</button
            >
          {:else}
            {@render rating('How do you feel?', moodRating, (n) => (moodRating = n))}
            {@render rating('Energy level?', energyRating, (n) => (energyRating = n))}
            {@render rating('Hunger level?', hungerRating, (n) => (hungerRating = n))}
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
          {/if}
          {#if finishError}
            <p class="text-sm" style="color: #f87171;">{finishError}</p>
          {/if}
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-xl border py-2.5 text-sm font-medium text-text-muted"
              style="border-color: var(--color-border);"
              onclick={() => (showStopPanel = false)}
            >Keep fasting</button>
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
        {#if eatingWindow}
          <div class="mt-1 text-sm" aria-label="Eating window">
            {#if eatingWindow.text}
              <p class="font-medium" style="color: {eatingWindow.open ? 'var(--color-brand)' : 'var(--color-text-muted)'};">{eatingWindow.text}</p>
            {/if}
            <p class="text-xs text-text-muted">{eatingWindow.lastFast}</p>
          </div>
        {/if}
        {#if schedule}
          <p class="text-sm font-medium" style="color: {schedule.late ? '#fbbf24' : 'var(--color-text-muted)'};">{schedule.text}</p>
        {/if}
      </div>

      <MethodPicker bind:selectedId={selectedPresetId} />

      <div class="w-full">
        <p class="mb-2 text-sm font-medium text-text-muted">Started</p>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Started">
          {#each [...EARLIER, { id: 'pick', label: 'Pick a time' }] as option (option.id)}
            <button
              class="rounded-full border px-3 py-1.5 text-sm"
              aria-pressed={startedChoice === option.id}
              style={startedChoice === option.id
                ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                : 'background: var(--color-surface-2); color: var(--color-text); border-color: var(--color-border);'}
              onclick={() => {
                startedChoice = option.id;
                if (option.id === 'pick' && !pickedStart) pickedStart = toDatetimeLocal(Date.now() - 60 * 60_000);
              }}>{option.label}</button
            >
          {/each}
        </div>
        {#if startedChoice === 'pick'}
          <input
            type="datetime-local"
            bind:value={pickedStart}
            aria-label="Fast started at"
            class="mt-2 w-full rounded-lg border bg-transparent p-2 text-sm text-text"
            style="border-color: var(--color-border);"
          />
        {/if}
      </div>

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
  </div>

  <ZoneReferenceList currentZoneId={fastTimer.activeFast ? fastTimer.zone.id : null} />
</div>

<BottomSheet bind:open={editActiveOpen}>
  <EditFastSheet bind:open={editActiveOpen} fast={fastTimer.activeFast} />
</BottomSheet>

<BottomSheet bind:open={changeGoalOpen}>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-text">Change goal</h2>
    <p class="text-sm text-text-muted">The fast keeps its start time; only the goal changes.</p>
    <MethodPicker bind:selectedId={goalPresetId} />
    {#if goalError}<p class="text-sm" style="color: #f87171;">{goalError}</p>{/if}
    <button class="w-full rounded-xl py-2.5 text-sm font-semibold" style="background: var(--color-brand); color: #06140c;" onclick={saveGoal}
      >Save goal</button
    >
  </div>
</BottomSheet>
