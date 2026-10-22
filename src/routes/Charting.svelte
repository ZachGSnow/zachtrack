<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { EChartsOption } from 'echarts';
  import { db, type TrackableEntry } from '../lib/db';
  import { addDays, formatShortDate, startOfDay } from '../lib/utils/time';
  import { rangeStartFor, type ChartRange } from '../lib/utils/stats';
  import {
    buildFastingMetrics,
    buildTrackableMetrics,
    GRANULARITIES,
    valueOnDay,
    type Granularity,
    type MetricDef,
  } from '../lib/utils/metrics';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { resolveBodyFieldIds } from '../lib/utils/health';
  import EChart from '../lib/components/EChart.svelte';
  import DataTable from '../lib/components/DataTable.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';

  const fasts = liveQuery(() => db.fasts.toArray());
  const trackables = liveQuery(() => db.trackableDefinitions.orderBy('name').toArray());
  const allEntries = liveQuery(() => db.trackableEntries.toArray());
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());

  type ViewMode = 'table' | 'chart';

  const RANGES: { id: ChartRange; label: string }[] = [
    { id: '7', label: '7d' },
    { id: '30', label: '30d' },
    { id: '90', label: '90d' },
    { id: 'all', label: 'All' },
  ];
  const VIEWS: { id: ViewMode; label: string }[] = [
    { id: 'table', label: 'Table' },
    { id: 'chart', label: 'Chart' },
  ];

  const PREFS_KEY = 'data-view';
  const saved = loadPrefs<{ range: unknown; granularity: unknown; view: unknown; visible: unknown }>(PREFS_KEY, {
    range: '90',
    granularity: 'week',
    view: 'table',
    visible: { 'fasting:hours': true },
  });

  let range = $state<ChartRange>(oneOf(saved.range, RANGES.map((r) => r.id), '90'));
  let granularity = $state<Granularity>(oneOf(saved.granularity, GRANULARITIES.map((g) => g.id), 'week'));
  let view = $state<ViewMode>(oneOf(saved.view, VIEWS.map((v) => v.id), 'table'));
  let visible = $state<Record<string, boolean>>(
    saved.visible && typeof saved.visible === 'object' ? (saved.visible as Record<string, boolean>) : { 'fasting:hours': true },
  );

  $effect(() => {
    savePrefs(PREFS_KEY, { range, granularity, view, visible });
  });

  const PALETTE = ['#22ff88', '#a855f7', '#38bdf8', '#f97316', '#eab308', '#ec4899', '#818cf8', '#10b981', '#f472b6', '#60a5fa', '#ef4444', '#22d3ee'];

  // Axis groups that read naturally on the left (count/hour-like); everything else defaults right.
  const LEFT_GROUPS = new Set(['fastingHours', 'fastingTotal', 'occurrence']);

  const entriesByTrackable = $derived.by(() => {
    const map = new Map<string, TrackableEntry[]>();
    for (const e of $allEntries ?? []) {
      const list = map.get(e.trackableId) ?? [];
      list.push(e);
      map.set(e.trackableId, list);
    }
    return map;
  });

  // Shared range start for every metric, computed from the union of all
  // timestamps so 'all' stays consistent across sources.
  const rangeStart = $derived(
    rangeStartFor(range, [...($fasts ?? []).map((f) => f.startTime), ...($allEntries ?? []).map((e) => e.timestamp)]),
  );

  const dayList = $derived.by(() => {
    const today = startOfDay(Date.now());
    const days: number[] = [];
    for (let d = rangeStart; d <= today; d = addDays(d, 1)) days.push(d);
    return days;
  });

  const catalog = $derived.by((): MetricDef[] => {
    let colorCursor = 0;
    const nextColor = () => PALETTE[colorCursor++ % PALETTE.length];
    const bodyFieldIds = resolveBodyFieldIds($allFields ?? [], settingsStore.data);
    return [
      ...buildFastingMetrics($fasts ?? []),
      ...($trackables ?? []).flatMap((t) =>
        buildTrackableMetrics(t, entriesByTrackable.get(t.id) ?? [], $allFields ?? [], nextColor, bodyFieldIds),
      ),
    ];
  });

  function toggle(id: string) {
    visible = { ...visible, [id]: !visible[id] };
  }

  const activeDefs = $derived(catalog.filter((d) => visible[d.id]));
  const anyVisible = $derived(activeDefs.length > 0);

  const axisGroupKeys = $derived([...new Set(catalog.map((d) => d.axisGroup))]);
  const activeAxisGroups = $derived(new Set(activeDefs.map((d) => d.axisGroup)));
  const leftAxisGroups = $derived(axisGroupKeys.filter((g) => LEFT_GROUPS.has(g) && activeAxisGroups.has(g)));
  const rightAxisGroups = $derived(axisGroupKeys.filter((g) => !LEFT_GROUPS.has(g) && activeAxisGroups.has(g)));

  const AXIS_GAP = 48;
  const AXIS_BASE = 16;

  function axisOffset(group: string): number {
    const list = LEFT_GROUPS.has(group) ? leftAxisGroups : rightAxisGroups;
    const idx = list.indexOf(group);
    return idx >= 0 ? idx * AXIS_GAP : 0;
  }

  const groupedCategories = $derived.by(() => {
    const groups: { group: string; series: MetricDef[] }[] = [];
    for (const def of catalog) {
      let g = groups.find((x) => x.group === def.group);
      if (!g) {
        g = { group: def.group, series: [] };
        groups.push(g);
      }
      g.series.push(def);
    }
    return groups;
  });

  function chartValue(def: MetricDef, day: number): number | null {
    const v = valueOnDay(def, day);
    return v == null ? null : Math.round(v * 100) / 100;
  }

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: {
      left: AXIS_BASE + leftAxisGroups.length * AXIS_GAP,
      right: AXIS_BASE + rightAxisGroups.length * AXIS_GAP,
      top: 44,
      bottom: 30,
    },
    legend: { textStyle: { color: '#8ba398' }, top: 4 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dayList.map((d) => formatShortDate(d)),
      axisLine: { lineStyle: { color: '#262e2a' } },
      axisLabel: { color: '#8ba398' },
    },
    yAxis: axisGroupKeys.map((group) => {
      const isLeft = LEFT_GROUPS.has(group);
      const seriesInGroup = catalog.filter((d) => d.axisGroup === group);
      const min = seriesInGroup.find((s) => s.axisMin != null)?.axisMin;
      const max = seriesInGroup.find((s) => s.axisMax != null)?.axisMax;
      return {
        type: 'value' as const,
        name: seriesInGroup[0]?.axisLabel ?? group,
        show: activeAxisGroups.has(group),
        position: isLeft ? ('left' as const) : ('right' as const),
        offset: axisOffset(group),
        min,
        max,
        scale: min == null,
        nameTextStyle: { color: '#8ba398' },
        axisLabel: { color: '#8ba398' },
        splitLine: group === 'fastingHours' ? { lineStyle: { color: '#1a201d' } } : { show: false },
      };
    }),
    series: activeDefs.map((def) => ({
      name: def.label,
      type: def.chartType,
      yAxisIndex: axisGroupKeys.indexOf(def.axisGroup),
      data: dayList.map((day) => chartValue(def, day)),
      ...(def.chartType === 'bar'
        ? { itemStyle: { color: def.color, borderRadius: [3, 3, 0, 0] as [number, number, number, number] }, barMaxWidth: 18 }
        : {
            // Straight segments with a marker on every real reading, so logged
            // points are distinguishable from the connecting line.
            smooth: false,
            connectNulls: true,
            showSymbol: def.rollup !== 'last',
            symbolSize: 5,
            itemStyle: { color: def.color },
            lineStyle: { color: def.color, width: 2 },
          }),
      ...(def.isWeightField && settingsStore.data.goalWeightLb
        ? {
            markLine: {
              symbol: 'none' as const,
              label: { formatter: 'Goal', color: '#8ba398' },
              lineStyle: { color: '#8ba398', type: 'dashed' as const, width: 1.5 },
              data: [{ yAxis: settingsStore.data.goalWeightLb }],
            },
          }
        : {}),
    })),
  });
</script>

<div class="flex flex-1 flex-col gap-5 px-5 py-6">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-semibold text-text">Data</h1>
    <SegmentedControl options={RANGES} bind:value={range} />
  </div>
  <p class="text-sm text-text-muted">Line up any combination of fasting and trackable data to spot correlations.</p>

  {#each groupedCategories as g (g.group)}
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="mr-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{g.group}</span>
      {#each g.series as def (def.id)}
        <button
          class="rounded-full border px-2.5 py-1 text-xs font-medium"
          style={visible[def.id]
            ? `background: ${def.color}22; color: ${def.color}; border-color: ${def.color}80;`
            : 'color: var(--color-text-muted); border-color: var(--color-border);'}
          onclick={() => toggle(def.id)}
        >{def.label}</button>
      {/each}
    </div>
  {/each}

  <div class="flex items-center justify-between gap-2">
    <SegmentedControl options={VIEWS} bind:value={view} />
    {#if view === 'table'}
      <SegmentedControl options={GRANULARITIES} bind:value={granularity} />
    {/if}
  </div>

  {#if view === 'table'}
    <DataTable metrics={activeDefs} {granularity} {rangeStart} />
  {:else if !anyVisible}
    <p class="rounded-2xl border p-6 text-center text-sm text-text-muted" style="border-color: var(--color-border); background: var(--color-surface);">
      Select at least one metric above to see the chart.
    </p>
  {:else}
    <div class="rounded-2xl border p-2" style="border-color: var(--color-border); background: var(--color-surface);">
      <EChart {option} height="320px" />
    </div>
  {/if}
</div>
