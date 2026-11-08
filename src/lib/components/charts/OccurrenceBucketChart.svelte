<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import { computeOccurrenceBuckets, type BucketUnit } from '../../utils/trackableStats';
  import type { ChartRange } from '../../utils/stats';
  import EChart from '../EChart.svelte';
  import { themeStore } from '../../stores/theme.svelte';
  import { chartColors } from '../../utils/theme';

  // Chart colours follow the theme (utils/theme.ts), since ECharts draws with literal colours.
  const ct = $derived(chartColors(themeStore.effective));

  let { entries, range, color }: { entries: { timestamp: number }[]; range: ChartRange; color?: string } = $props();
  // The brand green unless the trackable has its own colour.
  const seriesColor = $derived(color ?? ct.brand);

  let bucket = $state<BucketUnit>('day');

  const series = $derived(computeOccurrenceBuckets(entries, bucket, range));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 36, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: series.categories,
      axisLine: { lineStyle: { color: ct.line } },
      axisLabel: { color: ct.muted },
    },
    yAxis: {
      type: 'value',
      name: 'Count',
      nameTextStyle: { color: ct.muted },
      axisLabel: { color: ct.muted },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      { name: 'Occurrences', type: 'bar', data: series.counts, itemStyle: { color: seriesColor, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
    ],
  });

  const BUCKETS: { id: BucketUnit; label: string }[] = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
  ];
</script>

<div class="rounded-2xl border p-4 border-border bg-surface">
  <div class="mb-2 flex items-center justify-between">
    <p class="text-sm font-medium text-text-muted">Occurrences over time</p>
    <div class="flex overflow-hidden rounded-full border border-border">
      {#each BUCKETS as b (b.id)}
        <button
          class="px-2 py-1 text-xs font-medium"
          style={bucket === b.id ? 'background: var(--color-brand); color: var(--color-brand-fg);' : 'color: var(--color-text-muted);'}
          onclick={() => (bucket = b.id)}
        >{b.label}</button>
      {/each}
    </div>
  </div>
  <EChart {option} height="220px" />
</div>
