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
    // Logged against the goal (a slip, a day in a week over the limit): red.
    if (d.over) return 'var(--color-danger)';
    // Rest, skipped and paused days aren't misses: drawn hollow.
    if (d.off && d.level <= 0) return 'transparent';
    // A miss with nothing logged: a quiet red tint (an outline turned an every-day goal into a wall of boxes).
    if (d.level <= 0) return d.missed ? 'color-mix(in srgb, var(--color-danger) 30%, var(--color-surface-2))' : 'var(--color-surface-2)';
    return `color-mix(in srgb, ${color} ${Math.round(30 + 70 * d.level)}%, var(--color-surface-2))`;
  }

  function ring(d: GridDay): string {
    const rings: string[] = [];
    if (d.off && d.level <= 0 && !d.outside) rings.push('box-shadow: inset 0 0 0 1px var(--color-border);');
    // Part of a daily goal, but not all of it: the day's shade with a red ring.
    else if (d.missed && d.level > 0 && d.level < 1 && !d.over) rings.push('box-shadow: inset 0 0 0 1.5px var(--color-danger);');
    if (d.isToday) rings.push('outline: 1.5px solid var(--color-text-muted); outline-offset: 1px;');
    return rings.join(' ');
  }

  function describe(d: GridDay): string {
    const parts = [formatShortDate(d.day), d.count === 0 ? 'nothing logged' : `${d.count} ${d.count === 1 ? 'entry' : 'entries'}`];
    if (d.level > 0 && d.level < 1) parts.push(`${Math.round(d.level * 100)}% of goal`);
    if (d.note) parts.push(d.note);
    if (d.off) parts.push(d.off === 'rest' ? 'rest day' : d.off);
    if (d.isToday) parts.push('today');
    return parts.join(', ');
  }

  // A label over the day under the pointer, straight away (a native tooltip
  // waits a second and never shows on a phone, 3.74). A tap shows it on a
  // touch screen, for a few seconds.
  let host: HTMLDivElement | undefined = $state();
  let tip = $state<{ text: string; x: number; y: number; align: 'left' | 'center' | 'right' } | null>(null);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function show(d: GridDay, cell: HTMLElement, touch: boolean) {
    if (d.future || (d.outside && !onSelect) || !host) return;
    clearTimeout(hideTimer);
    const box = cell.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const x = box.left + box.width / 2 - frame.left;
    tip = { text: describe(d), x, y: box.top - frame.top, align: x < 90 ? 'left' : x > frame.width - 90 ? 'right' : 'center' };
    if (touch) hideTimer = setTimeout(() => (tip = null), 2500);
  }

  function hide(event: PointerEvent | FocusEvent) {
    if (event instanceof PointerEvent && event.pointerType === 'touch') return;
    tip = null;
  }

  // Drawing order: the grid's flow (column-wise for 'weeks', row-wise for 'calendar') places them.
  const cells = $derived(weeks.flat());
</script>

<div class="relative" bind:this={host} style="max-width: {columns * (maxCell + 4) + (showWeekdayColumn ? 18 : 0)}px;">
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
          style="background: {fill(d)}; {ring(d)}"
          aria-label={describe(d)}
          onpointerenter={(e) => show(d, e.currentTarget, e.pointerType === 'touch')}
          onpointerleave={hide}
          onfocus={(e) => show(d, e.currentTarget, false)}
          onblur={hide}
          onclick={() => onSelect(d)}
        >
          {#if dayNumbers}<span class:dark={d.level >= 0.5}>{new Date(d.day).getDate()}</span>{/if}
        </button>
      {:else}
        <span
          class="cell"
          style="background: {fill(d)}; {ring(d)}"
          role={d.outside ? undefined : 'img'}
          aria-label={d.outside ? undefined : describe(d)}
          onpointerenter={(e) => show(d, e.currentTarget, e.pointerType === 'touch')}
          onpointerleave={hide}
        >
          {#if dayNumbers && !d.outside}<span class:dark={d.level >= 0.5}>{new Date(d.day).getDate()}</span>{/if}
        </span>
      {/if}
    {/each}
  </div>
  {#if tip}
    <div
      class="tip pointer-events-none absolute z-20 w-max max-w-[14rem] rounded-md border px-2 py-1 text-xs leading-snug shadow-lg border-border bg-surface text-text"
      class:left={tip.align === 'left'}
      class:right={tip.align === 'right'}
      style="left: {tip.x}px; top: {tip.y - 6}px;"
      role="tooltip"
    >
      {tip.text}
    </div>
  {/if}
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
    color: var(--color-brand-fg);
    font-weight: 600;
  }
  .tip {
    transform: translate(-50%, -100%);
  }
  .tip.left {
    transform: translate(-12px, -100%);
  }
  .tip.right {
    transform: translate(calc(-100% + 12px), -100%);
  }
  button.cell:focus-visible {
    outline: 2px solid var(--color-brand);
    outline-offset: 1px;
  }
</style>
