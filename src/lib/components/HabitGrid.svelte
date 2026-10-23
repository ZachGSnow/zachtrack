<script lang="ts">
  import type { GridDay } from '../utils/habitGrid';
  import { formatShortDate } from '../utils/time';

  // A plain CSS grid, no chart library: square cells that grow to fill the
  // width they're given (up to `maxCell`), so the same grid works as a strip
  // on a phone card and across a laptop.
  // - orientation 'weeks': each inner array is a week drawn as a column, days
  //   Monday to Sunday top to bottom (the habit-tracker look).
  // - orientation 'calendar': each inner array is a week drawn as a row, like
  //   a month calendar, optionally with day numbers.
  let {
    weeks,
    color,
    orientation = 'weeks',
    dayNumbers = false,
    labels = true,
    maxCell = 28,
    onSelect,
  }: {
    weeks: GridDay[][];
    color: string;
    orientation?: 'weeks' | 'calendar';
    dayNumbers?: boolean;
    labels?: boolean;
    maxCell?: number;
    onSelect?: (day: GridDay) => void;
  } = $props();

  const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const columns = $derived(orientation === 'weeks' ? weeks.length : 7);
  const showWeekdayColumn = $derived(labels && orientation === 'weeks');

  /** Month names over the first column of each month (weeks orientation). */
  const monthLabels = $derived.by(() => {
    const labels = weeks.map((week, i) => {
      const first = week.find((d) => new Date(d.day).getDate() === 1) ?? (i === 0 ? week[0] : undefined);
      return first ? new Date(first.day).toLocaleDateString(undefined, { month: 'short' }) : '';
    });
    // The first column is labelled with its month only if the next month doesn't start right after it.
    if (labels.slice(1, 3).some(Boolean)) labels[0] = '';
    return labels;
  });

  function fill(d: GridDay): string {
    if (d.future) return 'transparent';
    if (d.outside) return 'color-mix(in srgb, var(--color-surface-2) 45%, transparent)';
    // An every-N-days goal fell overdue: a quiet red tint (an outline turned an every-day goal into a wall of boxes).
    if (d.level <= 0) return d.missed ? 'color-mix(in srgb, #f87171 30%, var(--color-surface-2))' : 'var(--color-surface-2)';
    return `color-mix(in srgb, ${color} ${Math.round(30 + 70 * d.level)}%, var(--color-surface-2))`;
  }

  function describe(d: GridDay): string {
    const parts = [formatShortDate(d.day), d.count === 0 ? 'nothing logged' : `${d.count} ${d.count === 1 ? 'entry' : 'entries'}`];
    if (d.level > 0 && d.level < 1) parts.push(`${Math.round(d.level * 100)}% of goal`);
    if (d.missed) parts.push('overdue');
    if (d.isToday) parts.push('today');
    return parts.join(', ');
  }

  // Drawing order: the grid's flow (column-wise for 'weeks', row-wise for 'calendar') places them.
  const cells = $derived(weeks.flat());
</script>

<div style="max-width: {columns * (maxCell + 4) + (showWeekdayColumn ? 18 : 0)}px;">
  {#if labels && orientation === 'weeks'}
    <div class="grid gap-[3px] text-[10px] text-text-muted" style="grid-template-columns: {showWeekdayColumn ? '14px ' : ''}repeat({columns}, minmax(0, 1fr));">
      {#if showWeekdayColumn}<span></span>{/if}
      {#each monthLabels as label, i (i)}
        <span class="overflow-visible whitespace-nowrap leading-4">{label}</span>
      {/each}
    </div>
  {/if}
  {#if labels && orientation === 'calendar'}
    <div class="mb-1 grid grid-cols-7 gap-[3px] text-center text-[10px] text-text-muted">
      {#each WEEKDAYS as w, i (i)}<span>{w}</span>{/each}
    </div>
  {/if}
  <div
    class="grid gap-[3px]"
    style={orientation === 'weeks'
      ? `grid-template-columns: ${showWeekdayColumn ? '14px ' : ''}repeat(${columns}, minmax(0, 1fr)); grid-template-rows: repeat(7, auto); grid-auto-flow: column;`
      : 'grid-template-columns: repeat(7, minmax(0, 1fr));'}
    role="group"
    aria-label="Days"
  >
    {#if showWeekdayColumn}
      {#each WEEKDAYS as w, i (i)}
        <span class="flex items-center text-[10px] leading-none text-text-muted">{i % 2 === 0 ? w : ''}</span>
      {/each}
    {/if}
    {#each cells as d (d.day)}
      {#if onSelect && !d.outside}
        <button
          type="button"
          class="cell"
          style="background: {fill(d)}; {d.isToday ? 'outline: 1.5px solid var(--color-text-muted); outline-offset: 1px;' : ''}"
          aria-label={describe(d)}
          title={describe(d)}
          onclick={() => onSelect(d)}
        >
          {#if dayNumbers}<span class:dark={d.level >= 0.5}>{new Date(d.day).getDate()}</span>{/if}
        </button>
      {:else}
        <span
          class="cell"
          style="background: {fill(d)}; {d.isToday ? 'outline: 1.5px solid var(--color-text-muted); outline-offset: 1px;' : ''}"
          title={d.outside ? undefined : describe(d)}
        >
          {#if dayNumbers && !d.outside}<span class:dark={d.level >= 0.5}>{new Date(d.day).getDate()}</span>{/if}
        </span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
    border-radius: 22%;
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .cell .dark {
    color: #06140c;
    font-weight: 600;
  }
  button.cell:focus-visible {
    outline: 2px solid var(--color-brand);
    outline-offset: 1px;
  }
</style>
