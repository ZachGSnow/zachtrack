<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FastRecord } from '../../db';
  import { computeHeatmapData, type ChartRange, type HeatmapMetric } from '../../utils/stats';
  import EChart from '../EChart.svelte';

  let { fasts, range }: { fasts: FastRecord[]; range: ChartRange } = $props();

  let metric = $state<HeatmapMetric>('hours');

  const METRICS: { id: HeatmapMetric; label: string }[] = [
    { id: 'hours', label: 'Hours' },
    { id: 'mood', label: 'Mood' },
    { id: 'energy', label: 'Energy' },
    { id: 'goal', label: 'Goal %' },
  ];

  const heatmap = $derived(computeHeatmapData(fasts, range, metric));
  const maxValue = $derived(() => {
    if (metric === 'hours') return Math.max(24, ...heatmap.data.map(([, v]) => v));
    if (metric === 'goal') return Math.max(100, ...heatmap.data.map(([, v]) => v));
    return 5; // mood/energy are 1-5
  });

  const CELL = 13;
  const numWeeks = $derived(
    Math.ceil((new Date(heatmap.end).getTime() - new Date(heatmap.start).getTime()) / (7 * 24 * 3600 * 1000)) + 1,
  );
  const chartWidth = $derived(`${Math.max(280, 36 + numWeeks * (CELL + 2))}px`);

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (params: unknown) => {
        const p = params as { data: [string, number] };
        const unit = metric === 'hours' ? 'h fasted' : metric === 'goal' ? '% of goal' : `/5 ${metric}`;
        return `${p.data[0]}: ${p.data[1]}${unit}`;
      },
    },
    visualMap: {
      min: 0,
      max: maxValue(),
      calculable: false,
      show: false,
      inRange: { color: ['#121614', '#0f4d2c', '#22ff88'] },
    },
    calendar: {
      range: [heatmap.start, heatmap.end],
      cellSize: [CELL, CELL],
      left: 30,
      right: 8,
      top: 20,
      itemStyle: { borderColor: '#0b0f0e', borderWidth: 3 },
      dayLabel: { color: '#8ba398', fontSize: 10 },
      monthLabel: { color: '#8ba398', fontSize: 11 },
      yearLabel: { show: false },
      splitLine: { lineStyle: { color: '#262e2a' } },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: heatmap.data,
      },
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <div class="mb-2 flex items-center justify-between">
    <p class="text-sm font-medium text-text-muted">Consistency</p>
    <div class="flex overflow-hidden rounded-full border" style="border-color: var(--color-border);">
      {#each METRICS as m (m.id)}
        <button
          class="px-2 py-1 text-xs font-medium"
          style={metric === m.id ? 'background: var(--color-brand); color: #06140c;' : 'color: var(--color-text-muted);'}
          onclick={() => (metric = m.id)}
        >{m.label}</button>
      {/each}
    </div>
  </div>
  {#if heatmap.data.length === 0}
    <p class="py-4 text-center text-sm text-text-muted">No data for this metric yet.</p>
  {:else}
    <div style="overflow-x: auto;">
      <EChart {option} height="150px" width={chartWidth} />
    </div>
  {/if}
</div>
