<script lang="ts">
  import { updateTrackable, type FieldDefinition, type TrackableDefinition, type TrackableEntry } from '../db';
  import { isoDay } from '../utils/trackableGoals';
  import { habitGridMonth, habitGridWeeks, type GridDay } from '../utils/habitGrid';
  import { formatClockTime, startOfDay } from '../utils/time';
  import { loadPrefs, oneOf, savePrefs } from '../utils/prefs';
  import HabitGrid from './HabitGrid.svelte';
  import SegmentedControl from './SegmentedControl.svelte';

  // The trackable page's main history view: the habit grid over a week, a
  // month (as a calendar), six months or a year. Tapping a day shows what was
  // logged and lets you add an entry for that date.
  let {
    trackable,
    entries,
    fields,
    onAddForDay,
    onEditEntry,
  }: {
    trackable: TrackableDefinition;
    entries: TrackableEntry[];
    fields: FieldDefinition[];
    onAddForDay: (timestamp: number) => void;
    onEditEntry: (entry: TrackableEntry) => void;
  } = $props();

  type Period = 'week' | 'month' | 'half' | 'year';
  const PERIODS: { id: Period; label: string }[] = [
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'half', label: '6 mo' },
    { id: 'year', label: 'Year' },
  ];
  const PREFS_KEY = 'habit-history';
  let period = $state<Period>(oneOf(loadPrefs<{ period: unknown }>(PREFS_KEY, { period: 'half' }).period, PERIODS.map((p) => p.id), 'half'));
  $effect(() => {
    savePrefs(PREFS_KEY, { period });
  });

  /** Month view: 0 = this month, -1 = last month, ... */
  let monthOffset = $state(0);
  let selected = $state<GridDay | null>(null);

  const now = Date.now();
  const monthStart = $derived.by(() => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1).getTime();
  });
  const monthName = $derived(new Date(monthStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  const grid = $derived.by(() => {
    if (period === 'month') return habitGridMonth(trackable, entries, fields, monthStart, now);
    // Week: the current week, drawn as one calendar row (its seven days in order).
    return habitGridWeeks(trackable, entries, fields, period === 'week' ? 1 : period === 'half' ? 26 : 53, now);
  });

  const selectedEntries = $derived(
    selected
      ? entries.filter((e) => startOfDay(e.timestamp) === selected!.day).sort((a, b) => a.timestamp - b.timestamp)
      : [],
  );

  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function summary(e: TrackableEntry): string {
    const parts = fields
      .filter((f) => e.values?.[f.id] != null)
      .map((f) => {
        const v = e.values![f.id];
        const text = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : nf.format(v);
        return `${f.name} ${text}${f.kind === 'number' && f.unit ? ` ${f.unit}` : ''}`;
      });
    if (e.note?.trim()) parts.push(e.note.trim());
    return parts.join(' \u00b7 ') || 'Logged';
  }

  const selectedSkipped = $derived(selected ? (trackable.skipDays ?? []).includes(isoDay(selected.day)) : false);

  /** Skipping a day keeps a streak going over it (sick, travelling); unskipping puts it back. */
  async function toggleSkip() {
    if (!selected) return;
    const key = isoDay(selected.day);
    const current = trackable.skipDays ?? [];
    const next = current.includes(key) ? current.filter((d) => d !== key) : [...current, key];
    await updateTrackable(trackable.id, { skipDays: next.length ? next : undefined });
  }

  function addForSelected() {
    if (!selected) return;
    // Today: now. An earlier day: midday, so it lands on that date whatever the time zone does.
    onAddForDay(selected.isToday ? Date.now() : selected.day + 12 * 3600 * 1000);
  }
</script>

<div class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <p class="text-sm font-medium text-text-muted">History</p>
    <SegmentedControl options={PERIODS} bind:value={period} />
  </div>

  {#if period === 'month'}
    <div class="mb-2 flex items-center justify-between text-sm">
      <button class="px-2 text-text-muted" onclick={() => (monthOffset -= 1)} aria-label="Previous month">&lsaquo;</button>
      <span class="text-text">{monthName}</span>
      <button class="px-2 text-text-muted disabled:opacity-30" disabled={monthOffset >= 0} onclick={() => (monthOffset += 1)} aria-label="Next month">&rsaquo;</button>
    </div>
    <HabitGrid weeks={grid} color={trackable.color} orientation="calendar" dayNumbers maxCell={52} onSelect={(d) => (selected = d)} />
  {:else if period === 'week'}
    <HabitGrid weeks={grid} color={trackable.color} orientation="calendar" dayNumbers maxCell={52} onSelect={(d) => (selected = d)} />
  {:else}
    <HabitGrid weeks={grid} color={trackable.color} maxCell={period === 'half' ? 26 : 18} onSelect={(d) => (selected = d)} />
  {/if}

  {#if selected}
    <div class="mt-3 rounded-xl border p-3" style="border-color: var(--color-border);">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-medium text-text">
          {new Date(selected.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
        <button class="text-xs text-text-muted" onclick={() => (selected = null)} aria-label="Close day">&times;</button>
      </div>
      {#if selectedEntries.length === 0}
        <p class="mt-1 text-xs text-text-muted">Nothing logged.</p>
      {:else}
        <ul class="mt-1 flex flex-col gap-1">
          {#each selectedEntries as e (e.id)}
            <li>
              <button class="w-full truncate text-left text-xs text-text-muted hover:text-text" onclick={() => onEditEntry(e)}>
                <span class="text-text">{formatClockTime(e.timestamp)}</span> {summary(e)}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button class="text-xs font-semibold" style="color: var(--color-brand);" onclick={addForSelected}>
          + Add an entry for this day
        </button>
        {#if trackable.goalType && trackable.goalType !== 'avoid'}
          <button class="text-xs text-text-muted hover:text-text" onclick={toggleSkip}>
            {selectedSkipped ? 'Unskip this day' : 'Skip this day'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
