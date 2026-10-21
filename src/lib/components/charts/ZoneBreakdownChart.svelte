<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FastRecord } from '../../db';
  import { computeZoneBreakdown, type ChartRange } from '../../utils/stats';
  import { zoneInfoStore } from '../../stores/zoneInfo.svelte';
  import EChart from '../EChart.svelte';

  let { fasts, range }: { fasts: FastRecord[]; range: ChartRange } = $props();

  const breakdown = $derived(computeZoneBreakdown(fasts, range));
  const hasData = $derived(breakdown.some((z) => z.hours > 0));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p: unknown) => {
      const item = p as { seriesName: string; value: number };
      return `${item.seriesName}: ${item.value}h`;
    } },
    xAxis: {
      type: 'value',
      show: false,
    },
    yAxis: {
      type: 'category',
      data: ['Time in zone'],
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: breakdown.map((zone) => ({
      name: zone.title,
      type: 'bar' as const,
      stack: 'total',
      data: [zone.hours],
      itemStyle: { color: zone.color },
      barWidth: 40,
    })),
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Time spent in each biological zone</p>
  {#if !hasData}
    <p class="py-4 text-center text-sm text-text-muted">Complete a fast to see your zone breakdown.</p>
  {:else}
    <EChart {option} height="90px" />
    <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {#each breakdown as zone (zone.zoneId)}
        <button
          class="flex items-center gap-1.5 text-xs text-text-muted"
          onclick={() => zoneInfoStore.show(zone.zoneId)}
        >
          <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {zone.color};"></span>
          {zone.title} ({zone.hours}h)
        </button>
      {/each}
    </div>
  {/if}
</div>
