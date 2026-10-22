<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { FieldDefinition, TrackableEntry } from '../../db';
  import { computeFieldSeries } from '../../utils/trackableStats';
  import type { ChartRange } from '../../utils/stats';
  import { computeBMI } from '../../utils/health';
  import { settingsStore } from '../../stores/settings.svelte';
  import EChart from '../EChart.svelte';

  let {
    entries,
    fields,
    range,
    weightFieldId,
  }: { entries: TrackableEntry[]; fields: FieldDefinition[]; range: ChartRange; weightFieldId?: string } = $props();

  const PALETTE = ['#22ff88', '#a855f7', '#38bdf8', '#f97316', '#eab308', '#ec4899', '#818cf8', '#10b981', '#60a5fa'];

  // One color per field from its place among all fields, so a pill and its line
  // match whichever other fields are switched on.
  const colorFor = (f: FieldDefinition) => PALETTE[Math.max(0, fields.indexOf(f)) % PALETTE.length];

  const weightField = $derived(weightFieldId ? fields.find((f) => f.id === weightFieldId) : undefined);
  const showBmiOption = $derived(!!weightField && !!settingsStore.data.heightInches);

  let visible = $state<Record<string, boolean>>({});

  $effect(() => {
    if (fields.length && Object.keys(visible).length === 0) {
      visible = { [fields[0].id]: true };
    }
  });

  function toggle(id: string) {
    visible = { ...visible, [id]: !visible[id] };
  }

  const fieldSeriesById = $derived(new Map(fields.map((f) => [f.id, computeFieldSeries(entries, f, range)])));

  const bmiValues = $derived(
    weightField && settingsStore.data.heightInches
      ? (fieldSeriesById.get(weightField.id)?.values ?? []).map((w) =>
          w != null ? Number(computeBMI(w, settingsStore.data.heightInches!).toFixed(1)) : null,
        )
      : null,
  );

  const categories = $derived(fields.length ? (fieldSeriesById.get(fields[0].id)?.categories ?? []) : []);
  const anyVisible = $derived(Object.values(visible).some(Boolean));

  const option = $derived<EChartsOption>({
    backgroundColor: 'transparent',
    grid: { left: 44, right: 16, top: 36, bottom: 30 },
    legend: { textStyle: { color: '#8ba398' }, top: 0 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: '#262e2a' } },
      axisLabel: { color: '#8ba398' },
    },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#8ba398' }, splitLine: { lineStyle: { color: '#1a201d' } } },
    series: [
      ...fields
        .filter((f) => visible[f.id])
        .map((f) => ({
          name: f.name,
          type: 'line' as const,
          data: fieldSeriesById.get(f.id)?.values ?? [],
          smooth: false,
          connectNulls: true,
          showSymbol: true,
          symbolSize: 5,
          itemStyle: { color: colorFor(f) },
          lineStyle: { color: colorFor(f), width: 2 },
          ...(f.id === weightField?.id && settingsStore.data.goalWeightLb
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
      ...(visible['__bmi'] && bmiValues
        ? [
            {
              name: 'BMI',
              type: 'line' as const,
              data: bmiValues,
              smooth: false,
              connectNulls: true,
              showSymbol: true,
              symbolSize: 5,
              itemStyle: { color: '#f472b6' },
              lineStyle: { color: '#f472b6', width: 2, type: 'dashed' as const },
            },
          ]
        : []),
    ],
  });
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <p class="mb-2 text-sm font-medium text-text-muted">Fields over time</p>
  <div class="mb-2 flex flex-wrap gap-1.5">
    {#each fields as field (field.id)}
      <button
        class="rounded-full border px-2.5 py-1 text-xs font-medium"
        style={visible[field.id]
          ? `background: ${colorFor(field)}22; color: ${colorFor(field)}; border-color: ${colorFor(field)}80;`
          : 'color: var(--color-text-muted); border-color: var(--color-border);'}
        onclick={() => toggle(field.id)}
      >{field.name}</button>
    {/each}
    {#if showBmiOption}
      <button
        class="rounded-full border px-2.5 py-1 text-xs font-medium"
        style={visible['__bmi']
          ? 'background: #f472b622; color: #f472b6; border-color: #f472b680;'
          : 'color: var(--color-text-muted); border-color: var(--color-border);'}
        onclick={() => toggle('__bmi')}
      >BMI</button>
    {/if}
  </div>
  {#if !anyVisible}
    <p class="py-6 text-center text-sm text-text-muted">Select a field above to see its trend.</p>
  {:else}
    <EChart {option} height="240px" />
  {/if}
</div>
