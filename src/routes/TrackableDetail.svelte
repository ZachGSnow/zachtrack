<script lang="ts">
  import { liveQuery } from 'dexie';
  import { MediaQuery } from 'svelte/reactivity';
  import { push, link } from 'svelte-spa-router';
  import { db, type TrackableEntry, type FieldDefinition } from '../lib/db';
  import { computeFieldTodayTotal, computeFieldValuesByDay } from '../lib/utils/trackableStats';
  import { changeTone, describeProjection, describeRange, goalDirection, projectGoalRange, trendFit, trendNow } from '../lib/utils/measurement';
  import { measurementView } from '../lib/stores/measurementView.svelte';
  import { kindStats, resolveKind, summarize } from '../lib/utils/trackableKinds';
  import { describeGoal, GOAL_STATE_COLORS, goalStats, goalStatus } from '../lib/utils/trackableGoals';
  import { goalFastFactor, trackableInsights } from '../lib/utils/insights';
  import { goalMet } from '../lib/utils/fastingJourney';
  import { DATE_KIND_ITEM, DATE_KIND_LABELS, dateKindOf, describeDate } from '../lib/utils/dates';
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
  import { themeStore } from '../lib/stores/theme.svelte';
  import { readableText } from '../lib/utils/color';
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
  import HelpLink from '../lib/components/HelpLink.svelte';
  import BackfillGrid from '../lib/components/BackfillGrid.svelte';
  import TrackableFieldsChart from '../lib/components/charts/TrackableFieldsChart.svelte';

  let { params }: { params: { id: string } } = $props();

  // Where the habit grid goes: under Log Entry on a phone, heading the right column on a laptop.
  const wide = new MediaQuery('min-width: 1024px');

  const trackable = liveQuery(() => db.trackableDefinitions.get(params.id));
  const entries = liveQuery(() =>
    db.trackableEntries
      .where('trackableId')
      .equals(params.id)
      .toArray()
      .then((list) => list.sort((a, b) => b.timestamp - a.timestamp)),
  );
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());
  // For insights comparing this trackable with the others.
  const allTrackables = liveQuery(() => db.trackableDefinitions.toArray());
  const allEntries = liveQuery(() => db.trackableEntries.toArray());
  const allFasts = liveQuery(() => db.fasts.toArray());

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
  // The trackable's colour as text, readable on this theme (utils/color.ts).
  const ink = $derived($trackable ? readableText($trackable.color, themeStore.effective) : 'inherit');
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
    // With a goal weight, the weight column's changes (and BMI's and body fat's, which follow it) are coloured.
    const better = goodDirection;
    if (better) return defs.map((d) => (d.isWeightField || d.id.endsWith(':bmi') || d === bodyFat ? { ...d, better } : d));
    return defs;
  });

  const rangeStart = $derived(rangeStartFor(range, ($entries ?? []).map((e) => e.timestamp)));

  // Re-render "2h ago" as time passes, not only when entries change.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const summary = $derived(summarize(kind, $entries ?? [], attachedFields, now, measurementView.view));
  // A trackable with a goal shows how the goal is going; the rest show the kind's figures.
  const stats = $derived(($trackable && !isAges && goalStats($trackable, $entries ?? [], attachedFields, now)) || kindStats(kind, $entries ?? [], attachedFields, now));
  const goal = $derived($trackable && !isAges ? goalStatus($trackable, $entries ?? [], attachedFields, now) : null);
  const goalText = $derived($trackable ? describeGoal($trackable, attachedFields) : null);

  // The weight field's page: where the 7-day average is heading against the
  // goal weight in Settings (utils/measurement.ts).
  // Which way the weight field should move: toward the goal weight from its 7-day average.
  const goodDirection = $derived.by(() => {
    const field = bodyFieldIds.weight ? attachedFields.find((f) => f.id === bodyFieldIds.weight) : undefined;
    if (kind !== 'measurement' || !field) return null;
    return goalDirection(trendNow(computeFieldValuesByDay($entries ?? [], field), now, measurementView.view.trend)?.current, settingsStore.data.goalWeightLb);
  });
  const TONE = { good: 'text-brand', bad: 'text-warn' } as const;
  function toneClass(change: number | null | undefined): string {
    const tone = changeTone(change, goodDirection);
    return tone ? TONE[tone] : '';
  }

  const projection = $derived.by(() => {
    const goalWeight = settingsStore.data.goalWeightLb;
    const field = bodyFieldIds.weight ? attachedFields.find((f) => f.id === bodyFieldIds.weight) : undefined;
    if (kind !== 'measurement' || !goalWeight || !field) return null;
    const byDay = computeFieldValuesByDay($entries ?? [], field);
    const t = trendNow(byDay, now, measurementView.view.trend);
    if (!t) return null;
    // The date as a range (3.54): at the fitted rate, and one standard error faster and slower.
    const p = projectGoalRange(t.current, goalWeight, trendFit(byDay, now), now);
    const text = describeProjection(p, goalWeight, field.unit);
    return text && p?.kind === 'toward' ? `${text}${describeRange(p)}` : text;
  });

  /** Hides one comparison on every device (settings.mutedInsights, synced). Plain copies for IndexedDB (ARCHITECTURE.md 4.4). */
  function hideInsight(key: string) {
    const current = [...(settingsStore.data.mutedInsights ?? [])];
    if (!current.includes(key)) settingsStore.update({ mutedInsights: [...current, key] });
  }

  const insights = $derived.by(() => {
    const t = $trackable;
    if (!t || isAges) return [];
    const others = ($allTrackables ?? [])
      .filter((o) => o.id !== t.id && !o.archived && o.displayMode !== 'ages')
      .map((o) => ({ trackable: o, entries: ($allEntries ?? []).filter((e) => e.trackableId === o.id) }));
    // Goal fasts count as a factor too (3.55), when there are any.
    const fasting = goalFastFactor($allFasts ?? [], (f) => goalMet(f, now));
    if (fasting.entries.length) others.push(fasting as (typeof others)[number]);
    return trackableInsights(t, $entries ?? [], attachedFields, others, now, new Set(settingsStore.data.mutedInsights ?? []));
  });

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

  // A dates trackable (kind 'ages', utils/dates.ts): each entry as its next occurrence,
  // soonest first; one-off dates that have passed go under Past, most recent first.
  const dateKind = $derived($trackable ? dateKindOf($trackable) : 'birthday');
  const dateItems = $derived(
    $trackable && isAges ? ($entries ?? []).map((e) => ({ entry: e, item: describeDate($trackable!, e, now) })) : [],
  );
  const upcomingItems = $derived(dateItems.filter((d) => d.item.daysUntil >= 0).sort((a, b) => a.item.daysUntil - b.item.daysUntil));
  const pastItems = $derived(dateItems.filter((d) => d.item.daysUntil < 0).sort((a, b) => b.item.daysUntil - a.item.daysUntil));

  function whenText(at: number): string {
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
    return new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  }

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

{#snippet history()}
  {#if $trackable}
    <HabitHistory
      trackable={$trackable}
      entries={$entries ?? []}
      fields={attachedFields}
      onAddForDay={(timestamp) => openLogNew(timestamp)}
      onEditEntry={openLogEdit}
    />
  {/if}
{/snippet}

{#if !$trackable}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
    <p class="text-sm text-text-muted">Loading&hellip;</p>
    <a href="/trackables" use:link class="text-sm font-medium text-brand">Back to Trackables</a>
  </div>
{:else}
  <div class="mx-auto flex w-full flex-1 flex-col gap-5 px-5 py-6 {isAges ? 'lg:max-w-3xl' : ''}">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-2xl">{$trackable.icon}</span>
        <h1 class="text-xl font-semibold text-text">{$trackable.name}</h1>
      </div>
      <button class="text-sm text-text-muted" onclick={() => (editOpen = true)}>Edit</button>
    </div>

    {#if isAges}
      <p class="-mt-3 text-xs text-text-muted">{DATE_KIND_LABELS[dateKind]}</p>
      <button
        class="w-full rounded-xl py-3 text-base font-semibold bg-brand text-brand-fg"
        onclick={() => openLogNew()}
      >+ {DATE_KIND_ITEM[dateKind].add}</button>

      {#snippet dateRow(d: (typeof dateItems)[number])}
        <li>
          <button
            class="w-full rounded-xl border p-3 text-left border-border bg-surface"
            onclick={() => openLogEdit(d.entry)}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-text">{d.item.name}</span>
              <span class="shrink-0 text-xs font-medium" style="color: {d.item.daysUntil <= 7 && d.item.daysUntil >= 0 ? ink : 'var(--color-text-muted)'};">
                {d.item.countdown}
              </span>
            </div>
            <p class="mt-1 text-xs text-text-muted">
              {whenText(d.item.at)}{d.item.detail ? `, ${d.item.detail.charAt(0).toLowerCase()}${d.item.detail.slice(1)}` : ''}{d.item.since ? ` \u00b7 ${d.item.since}` : ''}
            </p>
            {#if d.item.details}
              <p class="mt-1 whitespace-pre-line text-xs text-text">{d.item.details}</p>
            {/if}
          </button>
        </li>
      {/snippet}

      <div class="flex flex-col gap-4">
        {#if dateItems.length === 0}
          <p class="text-sm text-text-muted">Nothing added yet.</p>
        {:else}
          <ul class="flex flex-col gap-2" aria-label="Upcoming">
            {#each upcomingItems as d (d.entry.id)}{@render dateRow(d)}{/each}
          </ul>
          {#if pastItems.length}
            <div>
              <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Past</p>
              <ul class="flex flex-col gap-2" aria-label="Past">
                {#each pastItems as d (d.entry.id)}{@render dateRow(d)}{/each}
              </ul>
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <!-- One column on a phone. On a laptop: what it is and what to do on the left, its history on the right. -->
      <div class="flex flex-col gap-5 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div class="flex flex-col gap-5">
          <div
            class="rounded-2xl border p-4 text-center"
            style="border-color: {$trackable.color}40; background: linear-gradient(180deg, {$trackable.color}14, transparent);"
          >
            <p class="text-xs uppercase tracking-wide" style="color: {ink};">{summary.label}</p>
            <p class="mt-1 text-3xl font-semibold text-text">{summary.value}</p>
            {#each summary.sub as line, i (i)}
              <p class="mt-1 text-xs {toneClass(summary.subChanges?.[i]) || 'text-text-muted'}">{line}</p>
            {/each}
            {#if projection}
              <p class="mt-2 text-xs font-medium" style="color: {ink};">{projection}</p>
            {/if}
          </div>

          {#if kind === 'measurement' && attachedFields.some((f) => f.kind === 'number')}
            <!-- How a reading's trend is read, on this device (3.54). -->
            <div class="-mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted" role="group" aria-label="Trend">
              <SegmentedControl
                label="Trend"
                options={[{ id: 'average', label: '7-day average' }, { id: 'smoothed', label: 'Smoothed' }]}
                value={measurementView.view.trend}
                onchange={(trend) => measurementView.set({ trend })}
              />
              <label class="flex items-center gap-1.5">
                <input type="checkbox" class="h-4 w-4" style="accent-color: var(--color-brand);" checked={measurementView.view.leadWithTrend} onchange={(e) => measurementView.set({ leadWithTrend: (e.target as HTMLInputElement).checked })} />
                Lead with the trend
              </label>
            </div>
          {/if}

          {#if goal && goalText}
            <div class="rounded-xl border p-3 border-border bg-surface">
              <div class="flex items-baseline justify-between gap-2">
                <p class="text-xs text-text-muted">Goal: {goalText}</p>
                {#if goal.streak}
                  <p class="text-xs text-text-muted">{goal.streak}</p>
                {/if}
              </div>
              <p class="mt-1 text-base font-semibold" style="color: {GOAL_STATE_COLORS[goal.state] ?? 'var(--color-text)'};">{goal.text}</p>
              {#if goal.progress != null}
                <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Goal progress" aria-valuenow={Math.round(goal.progress * 100)} aria-valuemin="0" aria-valuemax="100">
                  <div class="h-full rounded-full" style="width: {goal.progress * 100}%; background: {GOAL_STATE_COLORS[goal.state] ?? $trackable.color};"></div>
                </div>
              {/if}
            </div>
          {/if}

          <button
            class="w-full rounded-xl py-3 text-base font-semibold bg-brand text-brand-fg"
            onclick={() => openLogNew()}
          >Log Entry</button>

          {#if showHabitHistory && !wide.current}
            {@render history()}
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
              <div class="rounded-xl border p-3 border-border bg-surface">
                <p class="text-xs text-text-muted">{stat.label}</p>
                <p class="mt-1 text-lg font-semibold {toneClass(stat.change) || 'text-text'}">{stat.value}</p>
              </div>
            {/each}
          </div>
        </div>

        <div class="flex min-w-0 flex-col gap-5">
          {#if showHabitHistory && wide.current}
            {@render history()}
          {/if}

          {#if insights.length > 0}
            <section class="rounded-2xl border p-4 border-border bg-surface" aria-label="Insights">
              <p class="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-muted"><span>Insights</span> <HelpLink topic="insights" label="insights" /></p>
              <ul class="flex flex-col gap-1.5">
                {#each insights as insight, i (i)}
                  <li class="flex items-start gap-2 text-sm text-text">
                    <span class="min-w-0 flex-1"><span class="text-xs text-text-muted">{insight.label}:</span> {insight.text}</span>
                    {#if insight.key}
                      <!-- A comparison can be hidden; Settings > Insights lists hidden ones to bring back. -->
                      <button class="shrink-0 text-xs text-text-muted hover:text-text" onclick={() => hideInsight(insight.key!)} aria-label="Hide this comparison">Hide</button>
                    {/if}
                  </li>
                {/each}
              </ul>
              <p class="mt-2 text-[11px] text-text-muted">From your own entries; patterns, not causes.</p>
            </section>
          {/if}

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
              <TrackableFieldsChart entries={$entries ?? []} fields={attachedFields} {range} weightFieldId={bodyFieldIds.weight} bodyFatByDay={trendMetrics.find((d) => d.id.endsWith(':navy-body-fat'))?.valuesByDay} trendMode={measurementView.view.trend} hideReadings={measurementView.view.leadWithTrend} />
            {/if}
          </div>

          <!-- Charts that suit the kind: when it happens matters for events, which days for check-ins. -->
          {#if kind === 'event'}
            <OccurrenceBucketChart entries={$entries ?? []} {range} color={$trackable.color} />
            <IntervalTrendChart entries={$entries ?? []} color={$trackable.color} />
          {/if}

          <BackfillGrid trackable={$trackable} fields={attachedFields} entries={$entries ?? []} />

          <TagFilter items={$entries ?? []} bind:selected={tagFilter} />
          <EntriesTable entries={listedEntries} fields={attachedFields} onSelect={openLogEdit} />
        </div>
      </div>
    {/if}
  </div>
{/if}

<BottomSheet bind:open={editOpen}>
  <EditTrackableSheet bind:open={editOpen} trackable={$trackable ?? null} onDeleted={() => push('/trackables')} />
</BottomSheet>

<BottomSheet bind:open={logOpen}>
  <LogTrackableEntrySheet bind:open={logOpen} trackable={$trackable ?? null} entry={editingEntry} defaultTimestamp={logTimestamp} />
</BottomSheet>
