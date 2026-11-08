<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db } from '../lib/db';
  import { DATES_WITHIN_DAYS, LOG_RECENT_DAYS, todayDates, todayHabits, todayLogs } from '../lib/utils/today';
  import { dateItemKey } from '../lib/utils/dates';
  import { readableGraphic } from '../lib/utils/color';
  import { themeStore } from '../lib/stores/theme.svelte';
  import { quickLog } from '../lib/stores/quickLog.svelte';
  import FastNow from '../lib/components/FastNow.svelte';
  import HabitRow from '../lib/components/HabitRow.svelte';
  import HabitMatrix from '../lib/components/HabitMatrix.svelte';
  import QuickLogHost from '../lib/components/QuickLogHost.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import SectionHeading from '../lib/components/ui/SectionHeading.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';

  // Today: what to do now, gathered from every part of the app (ARCHITECTURE.md
  // 3.41). The fast, the habits with a goal, what you've been logging, and the
  // dates coming up. Each row links to where the rest lives.
  const trackables = liveQuery(() => db.trackableDefinitions.toArray());
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());
  const allEntries = liveQuery(() => db.trackableEntries.toArray());

  // "2h ago", due states and the fast move with the clock.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const habits = $derived(todayHabits($trackables ?? [], $allFields ?? [], $allEntries ?? [], now));
  const logs = $derived(todayLogs($trackables ?? [], $allFields ?? [], $allEntries ?? [], now));
  const dates = $derived(todayDates($trackables ?? [], $allEntries ?? [], now));
  const hasDates = $derived(($trackables ?? []).some((t) => !t.archived && t.displayMode === 'ages'));
  const counted = $derived(habits.filter((h) => !h.offDay));
  const done = $derived(counted.filter((h) => h.goal?.state === 'done').length);

  const dateLine = $derived(new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  const when = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-4 px-5 py-6 lg:grid lg:max-w-6xl lg:grid-cols-2 lg:items-start lg:gap-6">
  <div class="lg:col-span-2">
    <h1 class="text-xl font-semibold text-text">Today</h1>
    <p class="text-sm text-text-muted">{dateLine}</p>
  </div>

  <div class="flex flex-col gap-4">
    <FastNow {now} />

    <section class="flex flex-col gap-2" aria-labelledby="today-habits">
      <SectionHeading id="today-habits" title="Habits">
        {#snippet action()}
          {#if counted.length > 0}
            <span class="text-xs text-text-muted">{done} of {counted.length} done</span>
          {/if}
        {/snippet}
      </SectionHeading>
      {#if $trackables === undefined}
        <p class="text-sm text-text-muted">Loading&hellip;</p>
      {:else if habits.length === 0}
        <EmptyState title="No goals yet" text="Give a trackable a goal in its Edit sheet and it shows up here each day with a check button.">
          {#snippet action()}
            <a href="/trackables" use:link class="text-sm font-semibold text-brand">Open Trackables</a>
          {/snippet}
        </EmptyState>
      {:else}
        <Card padding="px-3 py-1">
          <ul class="divide-y divide-border">
            {#each habits as h (h.trackable.id)}
              <HabitRow habit={h} {now} />
            {/each}
          </ul>
        </Card>
        <HabitMatrix {habits} {now} />
      {/if}
    </section>
  </div>

  <div class="flex flex-col gap-4">
    <section class="flex flex-col gap-2" aria-labelledby="today-log">
      <SectionHeading id="today-log" title="Log">
        {#snippet action()}
          <a href="/trackables" use:link class="text-xs font-semibold text-brand">All trackables</a>
        {/snippet}
      </SectionHeading>
      {#if logs.length === 0}
        <p class="px-1 text-sm text-text-muted">Nothing without a goal logged in the last {LOG_RECENT_DAYS} days.</p>
      {:else}
        <Card padding="px-3 py-1">
          <ul class="divide-y divide-border">
            {#each logs as l (l.trackable.id)}
              {@const ink = readableGraphic(l.trackable.color, themeStore.effective)}
              <li class="flex items-center gap-3 py-1.5">
                <a href="/trackables/{l.trackable.id}" use:link class="flex min-w-0 flex-1 items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" style="background: {l.trackable.color}22;">{l.trackable.icon}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-text">{l.trackable.name}</span>
                    <span class="block truncate text-xs text-text-muted">{l.summary}</span>
                  </span>
                </a>
                <button
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold"
                  style="background: {l.trackable.color}22; color: {ink};"
                  onclick={() => quickLog.log(l.trackable)}
                  aria-label="Log {l.trackable.name}"
                >+</button>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
    </section>

    {#if hasDates}
      <section class="flex flex-col gap-2" aria-labelledby="today-dates">
        <SectionHeading id="today-dates" title="Coming up">
          {#snippet action()}
            <a href="/dates" use:link class="text-xs font-semibold text-brand">All dates</a>
          {/snippet}
        </SectionHeading>
        <Card padding="px-3 py-1">
          {#if dates.length === 0}
            <p class="py-1.5 text-sm text-text-muted">Nothing in the next {DATES_WITHIN_DAYS} days.</p>
          {:else}
            <ul class="divide-y divide-border">
              {#each dates as d (dateItemKey(d))}
                <li>
                  <a href="/trackables/{d.trackableId}" use:link class="flex items-center gap-3 py-1.5 text-sm">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" style="background: {d.color}22;">{d.icon}</span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-text">{d.name}{d.detail ? `: ${d.detail}` : ''}</span>
                      <span class="block text-xs text-text-muted">{when(d.at)}</span>
                    </span>
                    <span class="shrink-0 text-xs font-medium" class:text-brand={d.daysUntil <= 1} class:text-text-muted={d.daysUntil > 1}>{d.countdown}</span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </section>
    {/if}
  </div>
</div>

<QuickLogHost />
