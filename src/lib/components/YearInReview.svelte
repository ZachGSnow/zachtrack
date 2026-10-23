<script lang="ts">
  import type { FastRecord, TrackableDefinition, TrackableEntry } from '../db';
  import { reviewYears, yearReview } from '../utils/yearReview';
  import { formatHoursShort } from '../utils/time';
  import SegmentedControl from './SegmentedControl.svelte';

  // Insights > Year in review (utils/yearReview.ts): this year so far, or an
  // earlier one, at a glance.
  let { fasts, trackables, entries }: { fasts: FastRecord[]; trackables: TrackableDefinition[]; entries: TrackableEntry[] } = $props();

  const now = Date.now();
  const years = $derived(reviewYears(fasts, entries, now).slice(0, 4));
  // The switcher works in strings; the year is a number.
  let year = $state(String(new Date(now).getFullYear()));
  const options = $derived(years.map((y) => ({ id: String(y), label: String(y) })));
  const r = $derived(yearReview(Number(year), fasts, trackables, entries, now));
  const nf = new Intl.NumberFormat();
  const days = (n: number) => `${nf.format(n)} ${n === 1 ? 'day' : 'days'}`;
</script>

<section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="year-review">
  <div class="mb-3 flex items-center justify-between gap-2">
    <h2 id="year-review" class="text-sm font-semibold text-text">Year in review</h2>
    {#if options.length > 1}
      <SegmentedControl {options} bind:value={year} />
    {/if}
  </div>
  <p class="mb-3 text-xs text-text-muted">{r.year}{r.partial ? ' so far' : ''}</p>

  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {#each [
      { label: 'Fasts', value: nf.format(r.fasting.fasts), sub: `${r.fasting.goalFasts} met ${r.fasting.goalFasts === 1 ? 'its' : 'their'} goal` },
      { label: 'Hours fasted', value: formatHoursShort(r.fasting.hours), sub: `on ${days(r.fasting.daysFasted)}` },
      { label: 'Longest fast', value: r.fasting.fasts ? formatHoursShort(r.fasting.longestHours) : '-', sub: '' },
      { label: 'Longest goal streak', value: days(r.fasting.longestGoalStreak), sub: '' },
      { label: 'Entries logged', value: nf.format(r.logging.entries), sub: `on ${days(r.logging.daysLogged)}` },
      { label: 'Busiest month', value: r.busiestMonth ?? '-', sub: '' },
    ] as tile (tile.label)}
      <div class="rounded-xl border p-3" style="border-color: var(--color-border);">
        <p class="text-xs text-text-muted">{tile.label}</p>
        <p class="mt-1 text-lg font-semibold text-text">{tile.value}</p>
        {#if tile.sub}<p class="text-xs text-text-muted">{tile.sub}</p>{/if}
      </div>
    {/each}
  </div>

  {#if r.logging.top.length}
    <p class="mt-3 mb-1 text-xs text-text-muted">Logged on the most days</p>
    <ol class="flex flex-col gap-1 text-sm">
      {#each r.logging.top as t, i (t.id)}
        <li class="flex items-center gap-2">
          <span class="w-4 text-xs text-text-muted">{i + 1}.</span>
          <span class="w-6 text-center">{t.icon}</span>
          <span class="flex-1 truncate text-text">{t.name}</span>
          <span class="text-xs text-text-muted">{days(t.days)}</span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
