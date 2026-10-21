<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import { computeTrackableHeatmapData } from '../../utils/trackableStats';
  import type { ChartRange } from '../../utils/stats';
  import EChart from '../EChart.svelte';

  let { entries, range, color = '#22ff88' }: { entries: { timestamp: number }[]; range: ChartRange; color?: string } = $props();

  const heatmap = $derived(computeTrackableHeatmapData(entries, range));
  const maxValue = $derived(Math.max(1, ...heatmap.data.map(([, v]) => v)));

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
        return `${p.data[0]}: ${p.data[1]}x`;
      },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      show: false,
      inRange: { color: ['#121614', color] },
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
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: heatmap.data }],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Consistency</p>
  <div style="overflow-x: auto;">
    <EChart {option} height="150px" width={chartWidth} />
  </div>
</div>
