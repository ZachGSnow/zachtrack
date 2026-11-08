<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FastRecord } from '../../db';
  import { computeDayOfWeekPattern } from '../../utils/stats';
  import EChart from '../EChart.svelte';
  import { themeStore } from '../../stores/theme.svelte';
  import { chartColors } from '../../utils/theme';

  let { fasts }: { fasts: FastRecord[] } = $props();

  const pattern = $derived(computeDayOfWeekPattern(fasts));

  // Chart colours follow the theme (utils/theme.ts), since ECharts draws with literal colours.
  const ct = $derived(chartColors(themeStore.effective));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: pattern.labels,
      axisLine: { lineStyle: { color: ct.line } },
      axisLabel: { color: ct.muted },
    },
    yAxis: {
      type: 'value',
      name: 'Avg hours',
      nameTextStyle: { color: ct.muted },
      axisLabel: { color: ct.muted },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      {
        name: 'Average fasting hours',
        type: 'bar',
        data: pattern.hours,
        itemStyle: { color: '#22d3ee', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 28,
      },
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Pattern by day of week</p>
  <EChart {option} height="220px" />
</div>
