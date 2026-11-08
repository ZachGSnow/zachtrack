<script lang="ts">
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import { liveQuery } from 'dexie';
  import { db, type FastRecord } from '../lib/db';
  import { formatDateTime, formatHoursShort } from '../lib/utils/time';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditFastSheet from '../lib/components/EditFastSheet.svelte';
  import TagFilter from '../lib/components/TagFilter.svelte';
  import AddPastFastSheet from '../lib/components/AddPastFastSheet.svelte';
  import HabitGrid from '../lib/components/HabitGrid.svelte';
  import { fastMonth } from '../lib/utils/fastingJourney';
  import { startOfDay } from '../lib/utils/time';
  import type { GridDay } from '../lib/utils/habitGrid';

  const fasts = liveQuery(() => db.fasts.orderBy('startTime').reverse().toArray());

  let tagFilter = $state<string | null>(null);
  const shown = $derived(tagFilter ? ($fasts ?? []).filter((f) => f.tags?.includes(tagFilter!)) : ($fasts ?? []));

  let sheetOpen = $state(false);
  let selectedFast = $state<FastRecord | null>(null);
  let addOpen = $state(false);

  function openFast(fast: FastRecord) {
    selectedFast = fast;
    sheetOpen = true;
  }

  // The month calendar (utils/fastingJourney.ts fastMonth): a cell per day shaded by its best
  // fast's progress to goal, weekly totals beside it, and a tap on a day opens its fast.
  let monthOffset = $state(0);
  const now = Date.now();
  const monthStart = $derived.by(() => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1).getTime();
  });
  const monthName = $derived(new Date(monthStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  const month = $derived(fastMonth($fasts ?? [], monthStart, now));
  const weekLabel = (row: GridDay[]) => new Date(row[0].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function openDay(d: GridDay) {
    const own = ($fasts ?? []).filter((f) => startOfDay(f.startTime) === d.day);
    if (own.length) openFast(own[0]);
  }
</script>

<div class="mx-auto flex w-full flex-1 lg:max-w-3xl flex-col gap-3 px-5 py-6">
  <div class="flex items-center justify-between gap-2">
    <h1 class="text-xl font-semibold text-text">History</h1>
    <button
      class="rounded-lg border px-3 py-1.5 text-sm text-text-muted border-border"
      onclick={() => (addOpen = true)}>+ Log a past fast</button
    >
  </div>

  {#if $fasts === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if $fasts.length === 0}
    <EmptyState icon="&#x2744;&#xFE0F;" title="No fasts yet" text="Start one from the Timer, or log a past one with the button above." class="mt-4" />
  {:else}
    <section class="rounded-2xl border border-border bg-surface p-4" aria-label="Fasting calendar">
      <div class="mb-2 flex items-center justify-between text-sm">
        <button class="px-2 text-text-muted" onclick={() => (monthOffset -= 1)} aria-label="Previous month">&lsaquo;</button>
        <span class="font-heading font-semibold text-text">{monthName}</span>
        <button class="px-2 text-text-muted disabled:opacity-30" disabled={monthOffset >= 0} onclick={() => (monthOffset += 1)} aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <HabitGrid weeks={month.rows} color="var(--color-brand)" orientation="calendar" dayNumbers maxCell={44} onSelect={openDay} />
        </div>
        <!-- One line per calendar row: that week's fasts. -->
        <ul class="mt-5 flex shrink-0 flex-col text-right text-[11px] leading-tight text-text-muted" aria-label="Weekly totals">
          {#each month.totals as t, i (i)}
            <li class="flex flex-col justify-center" style="height: calc((100% - 0px) / {month.rows.length}); min-height: 2.25rem;" aria-label="Week of {weekLabel(month.rows[i])}: {t.fasts} fasts, {t.goal} to goal, {formatHoursShort(t.hours)}">
              {#if t.fasts}
                <span class="text-text">{t.goal}/{t.fasts}</span>
                <span>{formatHoursShort(t.hours)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      <p class="mt-2 text-xs text-text-muted">Full: the fast met its goal. Right: goal fasts of fasts, and hours, each week. Tap a day to open its fast.</p>
    </section>
    <TagFilter items={$fasts} bind:selected={tagFilter} />
    <ul class="flex flex-col gap-2" aria-label="Fasts">
      {#each shown as fast (fast.id)}
        <li>
          <button
            class="w-full rounded-xl border p-3 text-left border-border bg-surface"
            onclick={() => openFast(fast)}
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-text">
                {fast.presetLabel ?? 'Custom fast'}
              </span>
              <span class="text-xs text-text-muted">{formatDateTime(fast.startTime)}</span>
            </div>
            <p class="mt-1 text-sm text-text-muted">
              {#if fast.endTime}
                Duration: {formatHoursShort((fast.endTime - fast.startTime) / 3600000)}
              {:else}
                <span style="color: var(--color-brand);">In progress&hellip;</span>
              {/if}
            </p>
            {#if fast.tags?.length}
              <p class="mt-1 flex flex-wrap gap-1">
                {#each fast.tags as tag (tag)}
                  <span class="rounded-full px-2 py-0.5 text-[11px] text-text-muted bg-surface-2">#{tag}</span>
                {/each}
              </p>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<BottomSheet bind:open={sheetOpen}>
  <EditFastSheet bind:open={sheetOpen} fast={selectedFast} />
</BottomSheet>

<BottomSheet bind:open={addOpen}>
  <AddPastFastSheet bind:open={addOpen} />
</BottomSheet>
