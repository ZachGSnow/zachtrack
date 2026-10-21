<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import { computeIntervalTrend } from '../../utils/trackableStats';
  import EChart from '../EChart.svelte';

  let { entries, color = '#a855f7' }: { entries: { timestamp: number }[]; color?: string } = $props();

  const trend = $derived(computeIntervalTrend(entries));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 44, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: trend.categories,
      axisLine: { lineStyle: { color: '#262e2a' } },
      axisLabel: { color: '#8ba398' },
    },
    yAxis: {
      type: 'value',
      name: 'Hours between',
      nameTextStyle: { color: '#8ba398' },
      axisLabel: { color: '#8ba398' },
      splitLine: { lineStyle: { color: '#1a201d' } },
    },
    series: [
      {
        name: 'Hours since previous',
        type: 'line',
        data: trend.intervalHours,
        smooth: false,
        showSymbol: true,
        symbolSize: 5,
        itemStyle: { color },
        lineStyle: { color, width: 2 },
      },
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Time between occurrences</p>
  {#if trend.categories.length === 0}
    <p class="py-4 text-center text-sm text-text-muted">Need at least 2 entries to show a trend.</p>
  {:else}
    <EChart {option} height="200px" />
  {/if}
</div>
