<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push, link } from 'svelte-spa-router';
  import { db, type TrackableEntry, type FieldDefinition } from '../lib/db';
  import { computeFieldTodayTotal } from '../lib/utils/trackableStats';
  import { formatShortDate } from '../lib/utils/time';
  import { kindStats, resolveKind, summarize } from '../lib/utils/trackableKinds';
  import { describeGoal, GOAL_STATE_COLORS, goalStatus } from '../lib/utils/trackableGoals';
  import { formatPreciseAge, daysUntilNextBirthday, ageTurningOn, formatBirthdayCountdown } from '../lib/utils/age';
  import { rangeStartFor, type ChartRange } from '../lib/utils/stats';
  import {
    buildBmiMetric,
    buildNavyBodyFatMetric,
    buildTrackableMetrics,
    GRANULARITIES,
    type Granularity,
    type MetricDef,
  } from '../lib/utils/metrics';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { resolveBodyFieldIds } from '../lib/utils/health';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import DataTable from '../lib/components/DataTable.svelte';
  import EntriesTable from '../lib/components/EntriesTable.svelte';
  import TagFilter from '../lib/components/TagFilter.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import LogTrackableEntrySheet from '../lib/components/LogTrackableEntrySheet.svelte';
  import OccurrenceBucketChart from '../lib/components/charts/OccurrenceBucketChart.svelte';
  import IntervalTrendChart from '../lib/components/charts/IntervalTrendChart.svelte';
  import HabitHistory from '../lib/components/HabitHistory.svelte';
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

  // Filters only the entries list below, not the stats or charts (ARCHITECTURE.md 3.21).
  let tagFilter = $state<string | null>(null);
  const listedEntries = $derived(tagFilter ? ($entries ?? []).filter((e) => e.tags?.includes(tagFilter!)) : ($entries ?? []));

  let editOpen = $state(false);
  let logOpen = $state(false);
  let editingEntry = $state<TrackableEntry | null>(null);

  const attachedFields = $derived(
    $trackable
      ? $trackable.fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null)
      : [],
  );

  // Resolved across all fields, not just this trackable's, so only one field is ever "the" weight (or waist...).
  const bodyFieldIds = $derived(resolveBodyFieldIds($allFields ?? [], settingsStore.data));

  const kind = $derived($trackable ? resolveKind($trackable, attachedFields).kind : 'event');
  const isAges = $derived(kind === 'ages');
  const showTrendsTable = $derived(attachedFields.length === 0 || trendsView === 'table');

  /** Entries-per-period column, one column per attached field, plus BMI right after Weight when height is set. */
  const trendMetrics = $derived.by((): MetricDef[] => {
    const t = $trackable;
    if (!t) return [];
    const defs = buildTrackableMetrics(t, $entries ?? [], attachedFields, () => t.color, bodyFieldIds);
    defs[0] = { ...defs[0], column: 'Entries' };
    const height = settingsStore.data.heightInches;
    const weightIdx = defs.findIndex((d) => d.isWeightField);
    if (height && weightIdx >= 0) defs.splice(weightIdx + 1, 0, buildBmiMetric(defs[weightIdx], height));
    // Navy body fat right after BMI, or after Waist when this trackable has no weight.
    const sex = settingsStore.data.bodyFatSex;
    const bodyFat = height && sex ? buildNavyBodyFatMetric(defs, sex, height) : undefined;
    if (bodyFat) {
      const anchors = [defs.findIndex((d) => d.id.endsWith(':bmi')), defs.findIndex((d) => d.isWeightField), defs.findIndex((d) => d.bodyRole === 'waist')];
      defs.splice((anchors.find((i) => i >= 0) ?? defs.length - 1) + 1, 0, bodyFat);
    }
    return defs;
  });

  const rangeStart = $derived(rangeStartFor(range, ($entries ?? []).map((e) => e.timestamp)));

  // Re-render "2h ago" as time passes, not only when entries change.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const summary = $derived(summarize(kind, $entries ?? [], attachedFields, now));
  const stats = $derived(kindStats(kind, $entries ?? [], attachedFields, now));
  const goal = $derived($trackable && !isAges ? goalStatus($trackable, $entries ?? [], attachedFields, now) : null);
  const goalText = $derived($trackable ? describeGoal($trackable, attachedFields) : null);

  /**
   * Today's combined total for each 'sum'-aggregated attached field (e.g. Water,
   * Calories), less the one a daily trackable's header already shows.
   */
  const todayTotals = $derived(
    attachedFields
      .filter((f) => f.aggregation === 'sum')
      .filter((f, i) => !(kind === 'daily' && i === 0 && f.kind === 'number'))
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

  let logTimestamp = $state<number | undefined>(undefined);

  function openLogNew(timestamp?: number) {
    editingEntry = null;
    logTimestamp = timestamp;
    logOpen = true;
  }

  // The habit grid is the main history view for trackables with a goal, and
  // for events and check-ins, where which days you logged is the point.
  const showHabitHistory = $derived(!!$trackable?.goalType || kind === 'event' || kind === 'checkin');

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
  <div class="mx-auto flex w-full flex-1 lg:max-w-3xl flex-col gap-5 px-5 py-6">
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
        onclick={() => openLogNew()}
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
        <p class="text-xs uppercase tracking-wide" style="color: {$trackable.color};">{summary.label}</p>
        <p class="mt-1 text-3xl font-semibold text-text">{summary.value}</p>
        {#each summary.sub as line, i (i)}
          <p class="mt-1 text-xs text-text-muted">{line}</p>
        {/each}
      </div>

      {#if goal && goalText}
        <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs text-text-muted">Goal: {goalText}</p>
            {#if goal.streak}
              <p class="text-xs text-text-muted">{goal.streak}</p>
            {/if}
          </div>
          <p class="mt-1 text-base font-semibold" style="color: {GOAL_STATE_COLORS[goal.state] ?? 'var(--color-text)'};">{goal.text}</p>
          {#if goal.progress != null}
            <div class="mt-2 h-1.5 overflow-hidden rounded-full" style="background: var(--color-border);" role="progressbar" aria-label="Goal progress" aria-valuenow={Math.round(goal.progress * 100)} aria-valuemin="0" aria-valuemax="100">
              <div class="h-full rounded-full" style="width: {goal.progress * 100}%; background: {GOAL_STATE_COLORS[goal.state] ?? $trackable.color};"></div>
            </div>
          {/if}
        </div>
      {/if}

      <button
        class="w-full rounded-xl py-3 text-base font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={() => openLogNew()}
      >Log Entry</button>

      {#if showHabitHistory}
        <HabitHistory
          trackable={$trackable}
          entries={$entries ?? []}
          fields={attachedFields}
          onAddForDay={(timestamp) => openLogNew(timestamp)}
          onEditEntry={openLogEdit}
        />
      {/if}

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
        {#each stats as stat (stat.label)}
          <div class="rounded-xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
            <p class="text-xs text-text-muted">{stat.label}</p>
            <p class="mt-1 text-lg font-semibold text-text">{stat.value}</p>
          </div>
        {/each}
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
          <TrackableFieldsChart entries={$entries ?? []} fields={attachedFields} {range} weightFieldId={bodyFieldIds.weight} bodyFatByDay={trendMetrics.find((d) => d.id.endsWith(':navy-body-fat'))?.valuesByDay} />
        {/if}
      </div>

      <!-- Charts that suit the kind: when it happens matters for events, which days for check-ins. -->
      {#if kind === 'event'}
        <OccurrenceBucketChart entries={$entries ?? []} {range} color={$trackable.color} />
        <IntervalTrendChart entries={$entries ?? []} color={$trackable.color} />
      {/if}

      <TagFilter items={$entries ?? []} bind:selected={tagFilter} />
      <EntriesTable entries={listedEntries} fields={attachedFields} onSelect={openLogEdit} />
    {/if}
  </div>
{/if}

<BottomSheet bind:open={editOpen}>
  <EditTrackableSheet bind:open={editOpen} trackable={$trackable ?? null} onDeleted={() => push('/trackables')} />
</BottomSheet>

<BottomSheet bind:open={logOpen}>
  <LogTrackableEntrySheet bind:open={logOpen} trackable={$trackable ?? null} entry={editingEntry} defaultTimestamp={logTimestamp} />
</BottomSheet>
