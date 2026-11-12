<script lang="ts">
  import type { TaskRepeat } from '../db';
  import { describeRepeat, repeatFor, WEEKDAY_SHORT, type RepeatKind } from '../utils/taskRepeat';

  // How a task's due date repeats (3.61). Each change saves straight away
  // through `onchange`; undefined means it doesn't repeat.
  let {
    repeat,
    dueOn,
    onchange,
  }: {
    repeat: TaskRepeat | undefined;
    dueOn: string;
    onchange: (repeat: TaskRepeat | undefined) => void;
  } = $props();

  const KINDS: Array<{ id: RepeatKind | ''; label: string }> = [
    { id: '', label: "Doesn't repeat" },
    { id: 'days', label: 'Daily' },
    { id: 'weeks', label: 'Weekly' },
    { id: 'months', label: 'Monthly, on a date' },
    { id: 'monthsNth', label: 'Monthly, on a weekday' },
    { id: 'years', label: 'Yearly' },
    { id: 'afterDone', label: "After it's done" },
  ];
  const UNIT: Record<Exclude<RepeatKind, 'afterDone'>, string> = { days: 'day', weeks: 'week', months: 'month', monthsNth: 'month', years: 'year' };
  const NTH = [
    { id: 1, label: 'first' },
    { id: 2, label: 'second' },
    { id: 3, label: 'third' },
    { id: 4, label: 'fourth' },
    { id: 5, label: 'fifth' },
    { id: -1, label: 'last' },
  ];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function setKind(kind: RepeatKind | '') {
    onchange(kind ? repeatFor(kind, dueOn, repeat?.every ?? 1) : undefined);
  }

  function setEvery(value: string) {
    if (!repeat) return;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 365) return;
    onchange({ ...repeat, every: n });
  }

  function toggleDay(d: number) {
    if (repeat?.type !== 'weeks') return;
    const has = repeat.weekdays.includes(d);
    // At least one day stays chosen.
    if (has && repeat.weekdays.length === 1) return;
    const weekdays = has ? repeat.weekdays.filter((x) => x !== d) : [...repeat.weekdays, d].sort((a, b) => a - b);
    onchange({ ...repeat, weekdays });
  }

  const inputClass = 'rounded-lg border bg-transparent p-2 text-sm text-text border-border';
</script>

<div class="space-y-2">
  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Repeat</span>
    <select class="{inputClass} w-full" value={repeat?.type ?? ''} onchange={(e) => setKind(e.currentTarget.value as RepeatKind | '')}>
      {#each KINDS as k (k.id)}
        <option value={k.id}>{k.label}</option>
      {/each}
    </select>
  </label>

  {#if repeat}
    <div class="flex flex-wrap items-center gap-2 text-sm text-text">
      {#if repeat.type === 'afterDone'}
        <input type="number" min="1" max="365" class="{inputClass} w-20" value={repeat.every} onchange={(e) => setEvery(e.currentTarget.value)} aria-label="How many" />
        <select class={inputClass} value={repeat.unit} onchange={(e) => onchange({ ...repeat, unit: e.currentTarget.value } as TaskRepeat)} aria-label="Unit">
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
          <option value="years">years</option>
        </select>
        <span>after it's done</span>
      {:else}
        <span>Every</span>
        <input type="number" min="1" max="365" class="{inputClass} w-20" value={repeat.every} onchange={(e) => setEvery(e.currentTarget.value)} aria-label="Every how many" />
        <span>{UNIT[repeat.type]}{repeat.every === 1 ? '' : 's'}</span>
        {#if repeat.type === 'months'}
          <span>on the</span>
          <select class={inputClass} value={repeat.day} onchange={(e) => onchange({ ...repeat, day: Number(e.currentTarget.value) } as TaskRepeat)} aria-label="Day of the month">
            {#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}
              <option value={d}>{d}</option>
            {/each}
            <option value={-1}>last day</option>
          </select>
        {:else if repeat.type === 'monthsNth'}
          <span>on the</span>
          <select class={inputClass} value={repeat.nth} onchange={(e) => onchange({ ...repeat, nth: Number(e.currentTarget.value) } as TaskRepeat)} aria-label="Which week">
            {#each NTH as n (n.id)}
              <option value={n.id}>{n.label}</option>
            {/each}
          </select>
          <select class={inputClass} value={repeat.weekday} onchange={(e) => onchange({ ...repeat, weekday: Number(e.currentTarget.value) } as TaskRepeat)} aria-label="Weekday">
            {#each WEEKDAYS as w, i (w)}
              <option value={i}>{w}</option>
            {/each}
          </select>
        {/if}
      {/if}
    </div>
    {#if repeat.type === 'weeks'}
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="On these days">
        {#each WEEKDAY_SHORT as label, d (label)}
          {@const on = repeat.weekdays.includes(d)}
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium {on ? 'border-brand bg-brand text-brand-fg' : 'border-border text-text-muted'}"
            aria-pressed={on}
            onclick={() => toggleDay(d)}>{label}</button
          >
        {/each}
      </div>
    {/if}
    <p class="text-xs text-text-muted">
      {describeRepeat(repeat, dueOn)}. {repeat.type === 'afterDone'
        ? 'Completing it sets the next due date from the day you complete it.'
        : 'Completing it moves it to the next date; done late, to the next date after today.'}
    </p>
  {/if}
</div>
