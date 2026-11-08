<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { TodayHabit } from '../utils/today';
  import { habitGridDays } from '../utils/habitGrid';
  import { readableGraphic } from '../utils/color';
  import { addDays, startOfDay } from '../utils/time';
  import { themeStore } from '../stores/theme.svelte';
  import { quickLog } from '../stores/quickLog.svelte';
  import HabitGrid from './HabitGrid.svelte';

  // Today's "Last 7 days": one row per habit, one cell per day, the way
  // Streaks and Habitify show a week. A tap on a cell logs that day (or takes
  // it back off), so a missed check-in can be filled in without opening the
  // trackable; a trackable with fields opens the sheet for that day instead.
  let { habits, now }: { habits: TodayHabit[]; now: number } = $props();

  const DAYS = 7;
  const CELL = 22;
  // The grid's own width: cells plus the 3px gaps HabitGrid draws between them.
  const width = `${DAYS * CELL + (DAYS - 1) * 3}px`;
  const days = $derived(Array.from({ length: DAYS }, (_, i) => addDays(startOfDay(now), i - (DAYS - 1))));
  const initial = (day: number) => new Date(day).toLocaleDateString(undefined, { weekday: 'narrow' });
</script>

<section class="rounded-2xl border border-border bg-surface px-3 py-2" aria-label="Last 7 days">
  <div class="grid items-center gap-x-3" style="grid-template-columns: minmax(0, 1fr) {width};">
    <p class="text-xs font-semibold tracking-wide text-text-muted uppercase">Last 7 days</p>
    <div class="grid gap-[3px]" style="grid-template-columns: repeat({DAYS}, minmax(0, 1fr));">
      {#each days as d (d)}
        <span class="text-center text-[10px] text-text-muted" class:font-semibold={d === startOfDay(now)} class:text-text={d === startOfDay(now)}>{initial(d)}</span>
      {/each}
    </div>
  </div>
  <ul class="mt-1 divide-y divide-border">
    {#each habits as h (h.trackable.id)}
      {@const ink = readableGraphic(h.trackable.color, themeStore.effective)}
      <li class="grid items-center gap-x-3 py-1.5" style="grid-template-columns: minmax(0, 1fr) {width};">
        <a href="/trackables/{h.trackable.id}" use:link class="flex min-w-0 items-center gap-2 text-sm text-text">
          <span class="shrink-0">{h.trackable.icon}</span>
          <span class="truncate">{h.trackable.name}</span>
        </a>
        <div style="width: {width};">
          <HabitGrid
            weeks={[habitGridDays(h.trackable, h.entries, h.fields, DAYS, now)]}
            color={ink}
            orientation="calendar"
            labels={false}
            maxCell={CELL}
            onSelect={(d) => quickLog.toggleOn(h.trackable, h.entries, d.day)}
          />
        </div>
      </li>
    {/each}
  </ul>
</section>
