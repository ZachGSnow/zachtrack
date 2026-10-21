<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push, link } from 'svelte-spa-router';
  import { db, type TrackableEntry, type FieldDefinition } from '../lib/db';
  import { computeOccurrenceStats, computeFieldTodayTotal, formatTimeSinceAdaptive } from '../lib/utils/trackableStats';
  import { formatDateTime, formatShortDate } from '../lib/utils/time';
  import { formatPreciseAge, daysUntilNextBirthday, ageTurningOn, formatBirthdayCountdown } from '../lib/utils/age';
  import { rangeStartFor, type ChartRange } from '../lib/utils/stats';
  import { buildBmiMetric, buildTrackableMetrics, GRANULARITIES, type Granularity, type MetricDef } from '../lib/utils/metrics';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import DataTable from '../lib/components/DataTable.svelte';
  import EntriesTable from '../lib/components/EntriesTable.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import LogTrackableEntrySheet from '../lib/components/LogTrackableEntrySheet.svelte';
  import OccurrenceBucketChart from '../lib/components/charts/OccurrenceBucketChart.svelte';
  import IntervalTrendChart from '../lib/components/charts/IntervalTrendChart.svelte';
  import TrackableHeatmapChart from '../lib/components/charts/TrackableHeatmapChart.svelte';
  import TrackableFieldsChart from '../lib/components/charts/TrackableFieldsChart.svelte';

  let { params }: { params: { id: string } } = $props();

  const trackable = liveQuery(() => db.trackableDefinitions.get(params.id));
  const entries = liveQuery(() =>
    db.trackableEntries
      .where('trackableId')
      .equals(params.id)
      .toArray()
      .then((list) => list.sort((a, b) => b.timestamp - a.timestamp)),
  );
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());

  type TrendsView = 'table' | 'chart';

  const RANGES: { id: ChartRange; label: string }[] = [
    { id: '7', label: '7d' },
    { id: '30', label: '30d' },
    { id: '90', label: '90d' },
    { id: 'all', label: 'All' },
  ];
  const VIEWS: { id: TrendsView; label: string }[] = [
    { id: 'table', label: 'Table' },
    { id: 'chart', label: 'Chart' },
  ];

  // Shared across all trackables on this device (not per-trackable).
  const PREFS_KEY = 'trackable-view';
  const saved = loadPrefs<{ range: unknown; granularity: unknown; trendsView: unknown }>(PREFS_KEY, {
    range: '90',
    granularity: 'week',
    trendsView: 'table',
  });

  let range = $state<ChartRange>(oneOf(saved.range, RANGES.map((r) => r.id), '90'));
  let granularity = $state<Granularity>(oneOf(saved.granularity, GRANULARITIES.map((g) => g.id), 'week'));
  let trendsView = $state<TrendsView>(oneOf(saved.trendsView, VIEWS.map((v) => v.id), 'table'));

  $effect(() => {
    savePrefs(PREFS_KEY, { range, granularity, trendsView });
  });

  let editOpen = $state(false);
  let logOpen = $state(false);
  let editingEntry = $state<TrackableEntry | null>(null);

  const attachedFields = $derived(
    $trackable
      ? $trackable.fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null)
      : [],
  );

  const isAges = $derived($trackable?.displayMode === 'ages');
  const showTrendsTable = $derived(attachedFields.length === 0 || trendsView === 'table');

  /** Entries-per-period column, one column per attached field, plus BMI right after Weight when height is set. */
  const trendMetrics = $derived.by((): MetricDef[] => {
    const t = $trackable;
    if (!t) return [];
    const defs = buildTrackableMetrics(t, $entries ?? [], attachedFields, () => t.color);
    defs[0] = { ...defs[0], column: 'Entries' };
    const height = settingsStore.data.heightInches;
    const weightIdx = defs.findIndex((d) => d.isWeightField);
    if (height && weightIdx >= 0) defs.splice(weightIdx + 1, 0, buildBmiMetric(defs[weightIdx], height));
    return defs;
  });

  const rangeStart = $derived(rangeStartFor(range, ($entries ?? []).map((e) => e.timestamp)));

  const stats = $derived(computeOccurrenceStats($entries ?? []));
  const lastEntry = $derived(($entries ?? [])[0] ?? null);
  const timeSince = $derived(lastEntry ? formatTimeSinceAdaptive(Date.now() - lastEntry.timestamp) : null);

  /** Today's combined total for each 'sum'-aggregated attached field (e.g. Water, Calories). */
  const todayTotals = $derived(
    attachedFields
      .filter((f) => f.aggregation === 'sum')
      .map((f) => ({ field: f, total: computeFieldTodayTotal($entries ?? [], f) }))
      .filter((t): t is { field: typeof t.field; total: number } => t.total != null),
  );

  const people = $derived(
    ($entries ?? [])
      .map((e) => ({
        entry: e,
        name: e.note?.trim() || 'Someone',
        age: formatPreciseAge(e.timestamp),
        daysUntil: daysUntilNextBirthday(e.timestamp),
        turning: ageTurningOn(e.timestamp),
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil),
  );

  function openLogNew() {
    editingEntry = null;
    logOpen = true;
  }

  function openLogEdit(e: TrackableEntry) {
    editingEntry = e;
    logOpen = true;
  }
</script>

{#if !$trackable}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
    <p class="text-sm text-text-muted">Loading&hellip;</p>
    <a href="/trackables" use:link class="text-sm font-medium" style="color: var(--color-brand);">Back to Trackables</a>
  </div>
{:else}
  <div class="flex flex-1 flex-col gap-5 px-5 py-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-2xl">{$trackable.icon}</span>
        <h1 class="text-xl font-semibold text-text">{$trackable.name}</h1>
      </div>
      <button class="text-sm text-text-muted" onclick={() => (editOpen = true)}>Edit</button>
    </div>

    {#if isAges}
      <button
        class="w-full rounded-xl py-3 text-base font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={openLogNew}
      >+ Add Person</button>

      <div>
        {#if people.length === 0}
          <p class="text-sm text-text-muted">No one added yet.</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each people as p (p.entry.id)}
              <li>
                <button
                  class="w-full rounded-xl border p-3 text-left"
                  style="border-color: var(--color-border); background: var(--color-surface);"
                  onclick={() => openLogEdit(p.entry)}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-text">{p.name}</span>
                    <span class="shrink-0 text-xs font-medium" style="color: {$trackable.color};">
                      {formatBirthdayCountdown(p.daysUntil)} (turns {p.turning})
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-text-muted">{p.age} old &middot; born {formatShortDate(p.entry.timestamp)}</p>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <div
        class="rounded-2xl border p-4 text-center"
        style="border-color: {$trackable.color}40; background: linear-gradient(180deg, {$trackable.color}14, transparent);"
      >
        <p class="text-xs uppercase tracking-wide" style="color: {$trackable.color};">Time since last</p>
        <p class="mt-1 text-3xl font-semibold text-text">{timeSince ?? '\u2014'}</p>
        {#if lastEntry}
          <p class="mt-1 text-xs text-text-muted">{formatDateTime(lastEntry.timestamp)}</p>
        {/if}
      </div>

      <button
        class="w-full rounded-xl py-3 text-base font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={openLogNew}
      >Log Entry</button>

      {#if todayTotals.length > 0}
        <div class="grid grid-cols-2 gap-2">
          {#each todayTotals as t (t.field.id)}
            <div
              class="rounded-xl border p-3"
              style="border-color: {$trackable.color}40; background: linear-gradient(180deg, {$trackable.color}14, transparent);"
            >
              <p class="text-xs text-text-muted">{t.field.name} today</p>
              <p class="mt-1 text-lg font-semibold text-text">
                {t.total}{t.field.unit ? ` ${t.field.unit}` : ''}
              </p>
            </div>
          {/each}
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
          <p class="text-xs text-text-muted">Total</p>
          <p class="mt-1 text-lg font-semibold text-text">{stats.total}</p>
        </div>
        <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
          <p class="text-xs text-text-muted">Current streak</p>
          <p class="mt-1 text-lg font-semibold text-text">{stats.currentStreakDays} <span class="text-sm font-normal text-text-muted">days</span></p>
        </div>
        <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
          <p class="text-xs text-text-muted">Avg interval</p>
          <p class="mt-1 text-lg font-semibold text-text">
            {stats.avgIntervalHours != null ? formatTimeSinceAdaptive(stats.avgIntervalHours * 3600000) : '\u2014'}
          </p>
        </div>
        <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
          <p class="text-xs text-text-muted">Longest gap</p>
          <p class="mt-1 text-lg font-semibold text-text">
            {stats.longestGapHours != null ? formatTimeSinceAdaptive(stats.longestGapHours * 3600000) : '\u2014'}
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium text-text-muted">Trends</p>
          <SegmentedControl options={RANGES} bind:value={range} />
        </div>
        <div class="flex items-center justify-between gap-2">
          {#if attachedFields.length > 0}
            <SegmentedControl options={VIEWS} bind:value={trendsView} />
          {:else}
            <span></span>
          {/if}
          {#if showTrendsTable}
            <SegmentedControl options={GRANULARITIES} bind:value={granularity} />
          {/if}
        </div>
        {#if showTrendsTable}
          <DataTable metrics={trendMetrics} {granularity} {rangeStart} />
        {:else}
          <TrackableFieldsChart entries={$entries ?? []} fields={attachedFields} {range} />
        {/if}
      </div>

      <OccurrenceBucketChart entries={$entries ?? []} {range} color={$trackable.color} />
      <TrackableHeatmapChart entries={$entries ?? []} {range} color={$trackable.color} />
      <IntervalTrendChart entries={$entries ?? []} color={$trackable.color} />

      <EntriesTable entries={$entries ?? []} fields={attachedFields} onSelect={openLogEdit} />
    {/if}
  </div>
{/if}

<BottomSheet bind:open={editOpen}>
  <EditTrackableSheet bind:open={editOpen} trackable={$trackable ?? null} onDeleted={() => push('/trackables')} />
</BottomSheet>

<BottomSheet bind:open={logOpen}>
  <LogTrackableEntrySheet bind:open={logOpen} trackable={$trackable ?? null} entry={editingEntry} />
</BottomSheet>
