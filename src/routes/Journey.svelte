<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { computeFastStats, rangeStartFor, type ChartRange } from '../lib/utils/stats';
  import { buildFastingMetrics, GRANULARITIES, type Granularity } from '../lib/utils/metrics';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { formatHoursShort } from '../lib/utils/time';
  import { fastGridWeeks, fastingWeightInsight, goalMet, weekComparison, COUNT_UP_GOAL_HOURS } from '../lib/utils/fastingJourney';
  import { resolveWeightField } from '../lib/utils/health';
  import { computeFieldValuesByDay } from '../lib/utils/trackableStats';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import DataTable from '../lib/components/DataTable.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import HabitGrid from '../lib/components/HabitGrid.svelte';
  import DurationHistogramChart from '../lib/components/charts/DurationHistogramChart.svelte';
  import DayOfWeekChart from '../lib/components/charts/DayOfWeekChart.svelte';
  import ZoneBreakdownChart from '../lib/components/charts/ZoneBreakdownChart.svelte';

  const fasts = liveQuery(() => db.fasts.orderBy('startTime').toArray());
  const fields = liveQuery(() => db.fieldDefinitions.toArray());
  const entries = liveQuery(() => db.trackableEntries.toArray());

  const RANGES: { id: ChartRange; label: string }[] = [
    { id: '7', label: '7d' },
    { id: '30', label: '30d' },
    { id: '90', label: '90d' },
    { id: 'all', label: 'All' },
  ];
  /** Weeks of the fasting grid per range: whole weeks, so a few more days than the range. */
  const GRID_WEEKS: Record<ChartRange, number> = { '7': 4, '30': 5, '90': 13, all: 53 };

  const PREFS_KEY = 'journey-view';
  const saved = loadPrefs<{ range: unknown; granularity: unknown }>(PREFS_KEY, { range: '90', granularity: 'week' });

  let range = $state<ChartRange>(oneOf(saved.range, RANGES.map((r) => r.id), '90'));
  let granularity = $state<Granularity>(oneOf(saved.granularity, GRANULARITIES.map((g) => g.id), 'week'));

  $effect(() => {
    savePrefs(PREFS_KEY, { range, granularity });
  });

  const now = Date.now();
  const stats = $derived(computeFastStats($fasts ?? []));
  const hasData = $derived(($fasts?.length ?? 0) > 0);
  const metrics = $derived(buildFastingMetrics($fasts ?? []));
  const rangeStart = $derived(
    rangeStartFor(
      range,
      ($fasts ?? []).filter((f) => f.endTime != null).map((f) => f.startTime),
    ),
  );
  const weeks = $derived(weekComparison($fasts ?? [], now));
  const grid = $derived(fastGridWeeks($fasts ?? [], GRID_WEEKS[range], now));

  // Insights: goal fasts over the last 30 days, and weight after goal fasts.
  const last30 = $derived(($fasts ?? []).filter((f) => f.endTime != null && f.startTime >= now - 30 * 24 * 3600_000));
  const weightInsight = $derived.by(() => {
    const field = resolveWeightField($fields ?? [], settingsStore.data.weightFieldId);
    if (!field || !$entries) return null;
    const byDay = computeFieldValuesByDay($entries.filter((e) => e.values?.[field.id] != null), field);
    return fastingWeightInsight($fasts ?? [], byDay, field.unit ?? '', now);
  });

  const delta = (a: number, b: number, fmt: (v: number) => string) => (a === b ? 'same' : `${a > b ? '+' : '-'}${fmt(Math.abs(a - b))}`);
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-5 px-5 py-6">
  <h1 class="text-xl font-semibold text-text">Journey</h1>

  {#if $fasts === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if !hasData}
    <p class="mt-8 text-center text-sm text-text-muted">Complete a fast to see your journey.</p>
  {:else}
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);" title="Days in a row with a fast that met its goal">
        <p class="text-xs text-text-muted">Goal streak</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.currentStreak} <span class="text-sm font-normal text-text-muted">{stats.currentStreak === 1 ? 'day' : 'days'}</span></p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Longest goal streak</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.longestStreak} <span class="text-sm font-normal text-text-muted">{stats.longestStreak === 1 ? 'day' : 'days'}</span></p>
      </div>
      <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
        <p class="text-xs text-text-muted">Days fasted</p>
        <p class="mt-1 text-lg font-semibold text-text">{stats.daysFasted30} <span class="text-sm font-normal text-text-muted">of 30</span></p>
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

    <section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="journey-week">
      <h2 id="journey-week" class="mb-2 text-sm font-semibold text-text">This week vs last week</h2>
      <table class="w-full text-left text-sm">
        <thead class="text-xs text-text-muted">
          <tr><th class="font-normal"></th><th class="font-normal">This week</th><th class="font-normal">Last week</th><th class="font-normal">Change</th></tr>
        </thead>
        <tbody class="text-text">
          <tr>
            <td class="text-text-muted">Goal fasts</td>
            <td>{weeks.thisWeek.goalFasts}</td>
            <td>{weeks.lastWeek.goalFasts}</td>
            <td class="text-text-muted">{delta(weeks.thisWeek.goalFasts, weeks.lastWeek.goalFasts, String)}</td>
          </tr>
          <tr>
            <td class="text-text-muted">Hours fasted</td>
            <td>{formatHoursShort(weeks.thisWeek.hours)}</td>
            <td>{formatHoursShort(weeks.lastWeek.hours)}</td>
            <td class="text-text-muted">{delta(Math.round(weeks.thisWeek.hours * 60), Math.round(weeks.lastWeek.hours * 60), (m) => formatHoursShort(m / 60))}</td>
          </tr>
          <tr>
            <td class="text-text-muted">Average start</td>
            <td>{weeks.thisWeek.averageStart ?? '-'}</td>
            <td>{weeks.lastWeek.averageStart ?? '-'}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-text-muted">A goal fast reached its target, or {COUNT_UP_GOAL_HOURS}h for a count-up fast. The week starts Monday.</p>
    </section>

    <section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="journey-grid">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h2 id="journey-grid" class="text-sm font-semibold text-text">Fasting days</h2>
        <SegmentedControl options={RANGES} bind:value={range} />
      </div>
      <HabitGrid weeks={grid} color="#22c55e" maxCell={range === 'all' ? 14 : 28} />
      <p class="mt-2 text-xs text-text-muted">A full square met its goal; a part-filled one got that far toward it.</p>
    </section>

    <section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="journey-insights">
      <h2 id="journey-insights" class="mb-2 text-sm font-semibold text-text">Insights</h2>
      <ul class="flex flex-col gap-1 text-sm text-text">
        <li>
          <span class="text-text-muted">Last 30 days:</span>
          {#if last30.length}
            goal met on {last30.filter((f) => goalMet(f, now)).length} of {last30.length} fasts
          {:else}
            no finished fasts
          {/if}
        </li>
        {#if weightInsight}
          <li><span class="text-text-muted">Weight:</span> {weightInsight}</li>
        {/if}
      </ul>
      <p class="mt-2 text-xs text-text-muted">Patterns, not causes. The weight line only shows with at least 5 days on each side and a clear difference.</p>
    </section>

    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <SegmentedControl options={GRANULARITIES} bind:value={granularity} />
        <SegmentedControl options={RANGES} bind:value={range} />
      </div>
      <DataTable {metrics} {granularity} {rangeStart} />
    </div>

    <div class="flex flex-col gap-5 lg:grid lg:grid-cols-2">
      <ZoneBreakdownChart fasts={$fasts ?? []} {range} />
      <DurationHistogramChart fasts={$fasts ?? []} />
      <DayOfWeekChart fasts={$fasts ?? []} />
    </div>
  {/if}
</div>
