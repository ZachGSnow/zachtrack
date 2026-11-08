<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FastRecord } from '../../db';
  import { computeDurationHistogram } from '../../utils/stats';
  import EChart from '../EChart.svelte';
  import { themeStore } from '../../stores/theme.svelte';
  import { chartColors } from '../../utils/theme';

  let { fasts }: { fasts: FastRecord[] } = $props();

  const histogram = $derived(computeDurationHistogram(fasts));

  // Chart colours follow the theme (utils/theme.ts), since ECharts draws with literal colours.
  const ct = $derived(chartColors(themeStore.effective));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: histogram.labels,
      axisLine: { lineStyle: { color: ct.line } },
      axisLabel: { color: ct.muted },
    },
    yAxis: {
      type: 'value',
      name: 'Fasts',
      nameTextStyle: { color: ct.muted },
      axisLabel: { color: ct.muted },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      {
        name: 'Fasts',
        type: 'bar',
        data: histogram.counts,
        itemStyle: { color: ct.brand, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Fast duration distribution</p>
  <EChart {option} height="220px" />
</div>
