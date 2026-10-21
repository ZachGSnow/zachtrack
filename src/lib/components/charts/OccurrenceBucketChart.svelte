<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import { computeOccurrenceBuckets, type BucketUnit } from '../../utils/trackableStats';
  import type { ChartRange } from '../../utils/stats';
  import EChart from '../EChart.svelte';

  let { entries, range, color = '#22ff88' }: { entries: { timestamp: number }[]; range: ChartRange; color?: string } = $props();

  let bucket = $state<BucketUnit>('day');

  const series = $derived(computeOccurrenceBuckets(entries, bucket, range));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 36, right: 16, top: 16, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: series.categories,
      axisLine: { lineStyle: { color: '#262e2a' } },
      axisLabel: { color: '#8ba398' },
    },
    yAxis: {
      type: 'value',
      name: 'Count',
      nameTextStyle: { color: '#8ba398' },
      axisLabel: { color: '#8ba398' },
      splitLine: { lineStyle: { color: '#1a201d' } },
    },
    series: [
      { name: 'Occurrences', type: 'bar', data: series.counts, itemStyle: { color, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
    ],
  });

  const BUCKETS: { id: BucketUnit; label: string }[] = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
  ];
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <div class="mb-2 flex items-center justify-between">
    <p class="text-sm font-medium text-text-muted">Occurrences over time</p>
    <div class="flex overflow-hidden rounded-full border" style="border-color: var(--color-border);">
      {#each BUCKETS as b (b.id)}
        <button
          class="px-2 py-1 text-xs font-medium"
          style={bucket === b.id ? 'background: var(--color-brand); color: #06140c;' : 'color: var(--color-text-muted);'}
          onclick={() => (bucket = b.id)}
        >{b.label}</button>
      {/each}
    </div>
  </div>
  <EChart {option} height="220px" />
</div>
