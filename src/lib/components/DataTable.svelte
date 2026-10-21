<script lang="ts">
  import {
    computeMetricTable,
    formatMetricDelta,
    formatMetricValue,
    metricTableToTsv,
    PERIOD_HEADERS,
    ROLLING_WINDOW_DAYS,
    type Granularity,
    type MetricDef,
  } from '../utils/metrics';
  import CopyButton from './CopyButton.svelte';

  let { metrics, granularity, rangeStart }: { metrics: MetricDef[]; granularity: Granularity; rangeStart: number } = $props();

  const table = $derived(computeMetricTable(metrics, granularity, rangeStart));
  const isDay = $derived(granularity === 'day');
  const hint = $derived(
    isDay ? `Gray: ${ROLLING_WINDOW_DAYS}-day average` : `Gray: change vs previous ${granularity === 'month' ? 'month' : 'week'}`,
  );

  const HEX_COLOR = /^#[0-9a-f]{6}$/i;

  // Per-column min/max of the visible rows, for shading cells by relative
  // magnitude. Deliberately neutral: stronger tint = higher value, not "better".
  const extents = $derived(
    metrics.map((m, i) => {
      if (m.rollup === 'last' || !HEX_COLOR.test(m.color)) return null;
      let min = Infinity;
      let max = -Infinity;
      for (const row of table.rows) {
        const v = row.cells[i].value;
        if (v == null) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      return max > min ? { min, max } : null;
    }),
  );

  function shade(i: number, v: number | null): string {
    const ext = extents[i];
    if (!ext || v == null) return '';
    const t = (v - ext.min) / (ext.max - ext.min);
    const alpha = Math.round(0x08 + t * (0x3a - 0x08))
      .toString(16)
      .padStart(2, '0');
    return `background: ${metrics[i].color}${alpha};`;
  }

  const summaryRows = $derived([
    { label: 'Avg', format: (m: MetricDef, v: number | null) => formatMetricValue(m, v), values: table.summary.avg },
    { label: 'Change', format: (m: MetricDef, v: number | null) => formatMetricDelta(m, v), values: table.summary.change },
    { label: 'Per wk', format: (m: MetricDef, v: number | null) => formatMetricDelta(m, v, '/wk'), values: table.summary.perWeek },
  ]);
</script>

<div class="rounded-2xl border" style="border-color: var(--color-border); background: var(--color-surface);">
  <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
    <p class="text-xs text-text-muted">{hint}</p>
    {#if metrics.length > 0}
      <CopyButton getText={() => metricTableToTsv(metrics, table)} />
    {/if}
  </div>

  {#if metrics.length === 0}
    <p class="px-3 pb-6 pt-2 text-center text-sm text-text-muted">Select at least one metric to see the table.</p>
  {:else}
    <div class="max-h-[60vh] overflow-auto rounded-b-2xl">
      <table class="w-full border-separate border-spacing-0 text-right tabular-nums">
        <thead>
          <tr>
            <th
              class="sticky left-0 top-0 z-20 bg-surface px-3 py-1.5 text-left align-bottom text-[10px] font-semibold uppercase tracking-wide text-text-muted"
            >{PERIOD_HEADERS[granularity]}</th>
            {#each metrics as m (m.id)}
              <th class="sticky top-0 z-10 min-w-[4.5rem] bg-surface px-2 py-1.5 align-bottom" title={m.label}>
                <span class="block whitespace-nowrap text-xs font-semibold" style="color: {m.color};">{m.column}</span>
                <span class="block h-3.5 text-[10px] font-normal text-text-muted">{m.unit ?? ''}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row (row.start)}
            <tr>
              <th scope="row" class="sticky left-0 z-10 whitespace-nowrap border-t border-border bg-surface px-3 py-1.5 text-left font-normal">
                <span class="block text-sm text-text">{row.label}</span>
                <span class="block h-3.5 text-[10px] text-text-muted">{row.sublabel ?? ''}</span>
              </th>
              {#each row.cells as cell, i (metrics[i].id)}
                <td class="whitespace-nowrap border-t border-border px-2 py-1.5" style={shade(i, cell.value)}>
                  <span class="block text-sm {cell.value == null ? 'text-text-muted' : 'text-text'}">
                    {formatMetricValue(metrics[i], cell.value, isDay)}
                  </span>
                  <span class="block h-3.5 text-[10px] text-text-muted">
                    {#if isDay}
                      {cell.secondary != null ? formatMetricValue(metrics[i], cell.secondary) : ''}
                    {:else}
                      {cell.secondary != null ? formatMetricDelta(metrics[i], cell.secondary) : ''}
                    {/if}
                  </span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
        <tfoot>
          {#each summaryRows as s, si (s.label)}
            <tr>
              <th
                scope="row"
                class="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted {si === 0 ? 'border-t-2 border-border' : ''}"
              >{s.label}</th>
              {#each metrics as m, i (m.id)}
                <td class="whitespace-nowrap px-2 py-1 text-xs text-text {si === 0 ? 'border-t-2 border-border' : ''}">
                  {s.format(m, s.values[i])}
                </td>
              {/each}
            </tr>
          {/each}
        </tfoot>
      </table>
    </div>
  {/if}
</div>
