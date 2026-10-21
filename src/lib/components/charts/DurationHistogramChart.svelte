<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FastRecord } from '../../db';
  import { computeDurationHistogram } from '../../utils/stats';
  import EChart from '../EChart.svelte';

  let { fasts }: { fasts: FastRecord[] } = $props();

  const histogram = $derived(computeDurationHistogram(fasts));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: histogram.labels,
      axisLine: { lineStyle: { color: '#262e2a' } },
      axisLabel: { color: '#8ba398' },
    },
    yAxis: {
      type: 'value',
      name: 'Fasts',
      nameTextStyle: { color: '#8ba398' },
      axisLabel: { color: '#8ba398' },
      splitLine: { lineStyle: { color: '#1a201d' } },
    },
    series: [
      {
        name: 'Fasts',
        type: 'bar',
        data: histogram.counts,
        itemStyle: { color: '#22ff88', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Fast duration distribution</p>
  <EChart {option} height="220px" />
</div>
