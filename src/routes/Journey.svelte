<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { computeFastStats, rangeStartFor, type ChartRange } from '../lib/utils/stats';
  import { buildFastingMetrics, GRANULARITIES, type Granularity } from '../lib/utils/metrics';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { formatHoursShort } from '../lib/utils/time';
  import DataTable from '../lib/components/DataTable.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import DurationHistogramChart from '../lib/components/charts/DurationHistogramChart.svelte';
  import DayOfWeekChart from '../lib/components/charts/DayOfWeekChart.svelte';
  import ConsistencyHeatmapChart from '../lib/components/charts/ConsistencyHeatmapChart.svelte';
  import ZoneBreakdownChart from '../lib/components/charts/ZoneBreakdownChart.svelte';

  const fasts = liveQuery(() => db.fasts.orderBy('startTime').toArray());

  const RANGES: { id: ChartRange; label: string }[] = [
    { id: '7', label: '7d' },
    { id: '30', label: '30d' },
    { id: '90', label: '90d' },
    { id: 'all', label: 'All' },
  ];

  const PREFS_KEY = 'journey-view';
  const saved = loadPrefs<{ range: unknown; granularity: unknown }>(PREFS_KEY, { range: '90', granularity: 'week' });

  let range = $state<ChartRange>(oneOf(saved.range, RANGES.map((r) => r.id), '90'));
  let granularity = $state<Granularity>(oneOf(saved.granularity, GRANULARITIES.map((g) => g.id), 'week'));

  $effect(() => {
    savePrefs(PREFS_KEY, { range, granularity });
  });

  const stats = $derived(computeFastStats($fasts ?? []));
  const hasData = $derived(($fasts?.length ?? 0) > 0);
  const metrics = $derived(buildFastingMetrics($fasts ?? []));
  const rangeStart = $derived(
    rangeStartFor(
      range,
      ($fasts ?? []).filter((f) => f.endTime != null).map((f) => f.startTime),
    ),
  );
</script>

<div class="mx-auto flex w-full flex-1 lg:max-w-3xl flex-col gap-5 px-5 py-6">
  <h1 class="text-xl font-semibold text-text">Journey</h1>

  {#if $fasts === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if !hasData}
    <p class="mt-8 text-center text-sm text-text-muted">Complete a fast to see your journey.</p>
  {:else}
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Current streak</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.currentStreak} <span class="text-sm font-normal text-text-muted">days</span></p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Longest streak</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.longestStreak} <span class="text-sm font-normal text-text-muted">days</span></p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Total fasts</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.totalFasts}</p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Average duration</p>
        <p class="mt-1 text-lg font-semibold text-text">{formatHoursShort(stats.averageHours)}</p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Longest fast</p>
        <p class="mt-1 text-lg font-semibold text-text">{formatHoursShort(stats.longestHours)}</p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Hit target</p>
        <p class="mt-1 text-lg font-semibold text-text">
          {#if stats.withTarget > 0}
            {Math.round((stats.hitTarget / stats.withTarget) * 100)}%
            <span class="text-sm font-normal text-text-muted">{stats.hitTarget} of {stats.withTarget}</span>
          {:else}
            &mdash;
          {/if}
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <SegmentedControl options={GRANULARITIES} bind:value={granularity} />
        <SegmentedControl options={RANGES} bind:value={range} />
      </div>
      <DataTable {metrics} {granularity} {rangeStart} />
    </div>

    <ZoneBreakdownChart fasts={$fasts ?? []} {range} />
    <ConsistencyHeatmapChart fasts={$fasts ?? []} {range} />
    <DurationHistogramChart fasts={$fasts ?? []} />
    <DayOfWeekChart fasts={$fasts ?? []} />
  {/if}
</div>
