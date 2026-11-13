<script lang="ts">
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import { readableText } from '../lib/utils/color';
  import { themeStore } from '../lib/stores/theme.svelte';
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db } from '../lib/db';
  import { dateItemKey, UPCOMING_DAYS, upcomingDates, type DateItem } from '../lib/utils/dates';
  import { addDays, startOfDay } from '../lib/utils/time';
  import { bucketStart } from '../lib/utils/trackableStats';
  import { push } from 'svelte-spa-router';
  import HelpLink from '../lib/components/HelpLink.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import QuickLogHost from '../lib/components/QuickLogHost.svelte';
  import { quickLog } from '../lib/stores/quickLog.svelte';
  import { datesToIcs } from '../lib/utils/ics';

  // The Dates tab (ARCHITECTURE.md 3.38, 3.75): birthdays, anniversaries,
  // holidays and countdowns, kept apart from the trackables you log. Three
  // pages: what's coming up in the next year, a month calendar, and the
  // lists themselves. Under the hood each list is still a trackable of the
  // dates kind, so its own page and syncing are unchanged.
  type View = 'list' | 'calendar' | 'lists';
  let { view = 'list' }: { view?: View } = $props();

  const trackables = liveQuery(() => db.trackableDefinitions.toArray());
  const entries = liveQuery(() => db.trackableEntries.toArray());

  const now = Date.now();
  const today = startOfDay(now);
  const datesTrackables = $derived(($trackables ?? []).filter((t) => !t.archived && t.displayMode === 'ages'));
  const archivedLists = $derived(($trackables ?? []).filter((t) => t.archived && t.displayMode === 'ages').sort((a, b) => a.name.localeCompare(b.name)));
  const lists = $derived([...datesTrackables].sort((a, b) => (a.pinned === b.pinned ? a.name.localeCompare(b.name) : a.pinned ? -1 : 1)));
  let showArchived = $state(false);
  const countIn = (id: string) => ($entries ?? []).filter((e) => e.trackableId === id).length;

  // "+ New list": the trackable sheet, offering only the dates templates.
  let newOpen = $state(false);

  // Every date as an .ics file (utils/ics.ts), made here and downloaded; nothing is uploaded.
  // Reminders in the file let the phone's own calendar alert, at each trackable's lead time (3.56).
  let withReminders = $state(false);

  function exportCalendar() {
    const ics = datesToIcs($trackables ?? [], $entries ?? [], Date.now(), { reminders: withReminders });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zachtrack-dates.ics';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const items = $derived(upcomingDates(datesTrackables, $entries ?? [], now, UPCOMING_DAYS));

  // --- List: Today, This week, then by month ---------------------------------
  const endOfWeek = addDays(bucketStart(now, 'week'), 6); // Sunday
  function groupOf(d: DateItem): string {
    if (d.daysUntil === 0) return 'Today';
    if (d.at <= endOfWeek) return 'This week';
    const at = new Date(d.at);
    const sameYear = at.getFullYear() === new Date(now).getFullYear();
    return at.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  }
  const groups = $derived.by(() => {
    const out: { label: string; items: DateItem[] }[] = [];
    for (const d of items) {
      const label = groupOf(d);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(d);
      else out.push({ label, items: [d] });
    }
    return out;
  });

  function when(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // --- Calendar: this month and the next 11 ------------------------------------
  let monthOffset = $state(0);
  let selectedDay = $state<number | null>(today);
  const monthStart = $derived(new Date(new Date(now).getFullYear(), new Date(now).getMonth() + monthOffset, 1).getTime());
  const monthLabel = $derived(new Date(monthStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  const byDay = $derived.by(() => {
    const map = new Map<number, DateItem[]>();
    for (const d of items) {
      const list = map.get(d.at);
      if (list) list.push(d);
      else map.set(d.at, [d]);
    }
    return map;
  });
  /** Weeks of the month as rows, Monday first; null pads the days outside it. */
  const weeks = $derived.by(() => {
    const first = new Date(monthStart);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const cells: (number | null)[] = Array(lead).fill(null);
    for (let i = 0; i < days; i++) cells.push(new Date(first.getFullYear(), first.getMonth(), i + 1).getTime());
    while (cells.length % 7) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  });
  const selectedItems = $derived(selectedDay != null ? (byDay.get(selectedDay) ?? []) : []);
</script>

{#snippet row(d: DateItem)}
  <li>
    <a href="/trackables/{d.trackableId}" use:link class="flex items-center gap-3 rounded-xl border p-3 border-border bg-surface">
      <span class="text-xl">{d.icon}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-text">{d.name}</span>
        <span class="block truncate text-xs text-text-muted">{when(d.at)}{d.detail ? `, ${d.detail.charAt(0).toLowerCase()}${d.detail.slice(1)}` : ''} &middot; {d.trackableName}</span>
        {#if d.details}
          <span class="block truncate text-xs text-text">{d.details}</span>
        {/if}
      </span>
      <span class="shrink-0 text-xs font-medium" style="color: {d.daysUntil <= 7 ? readableText(d.color, themeStore.effective) : 'var(--color-text-muted)'};">{d.countdown}</span>
    </a>
  </li>
{/snippet}

<div class="mx-auto flex w-full flex-1 flex-col gap-4 px-5 py-6 lg:max-w-3xl">
  <div class="flex items-center justify-between gap-2">
    <h1 class="flex items-center gap-2 text-xl font-semibold text-text"><span>Dates</span> <HelpLink topic="dates" label="dates" /></h1>
    <button class="rounded-full px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg" onclick={() => (newOpen = true)}>+ New list</button>
  </div>
  {#if datesTrackables.length > 0}
    <div class="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
      <button class="whitespace-nowrap font-semibold text-brand" onclick={exportCalendar}>Export to calendar</button>
      <span>for Google Calendar or any calendar app</span>
      <label class="flex items-center gap-1 whitespace-nowrap">
        <input type="checkbox" bind:checked={withReminders} class="h-3.5 w-3.5" style="accent-color: var(--color-brand);" />
        with reminders
      </label>
    </div>
  {/if}

  {#if $trackables === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if datesTrackables.length === 0}
    <EmptyState icon="&#x1F4C5;" title="No dates yet" text={'Tap "+ New list" and pick Birthdays, Anniversaries, US holidays or Countdowns.'} class="mt-4" />
  {:else if view === 'lists'}
    <ul class="flex flex-col gap-2" aria-label="Date lists">
      {#each lists as t (t.id)}
        {@const next = items.find((i) => i.trackableId === t.id)}
        {@const n = countIn(t.id)}
        <li class="flex items-center gap-3 rounded-xl border p-3 border-border bg-surface">
          <a href="/trackables/{t.id}" use:link class="flex min-w-0 flex-1 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style="background: {t.color}22;">{t.icon}</span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold text-text">{#if t.pinned}<span class="mr-1 text-xs" aria-label="Pinned">&#x1F4CC;</span>{/if}{t.name}</span>
              <span class="block truncate text-xs text-text-muted">{n} {n === 1 ? 'date' : 'dates'}{next ? ` \u00b7 next: ${next.name}, ${next.countdown.charAt(0).toLowerCase()}${next.countdown.slice(1)}` : ''}</span>
            </span>
          </a>
          <button
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
            style="background: {t.color}22; color: {readableText(t.color, themeStore.effective)};"
            onclick={() => quickLog.log(t)}
            aria-label="Add to {t.name}"
          >+</button>
        </li>
      {/each}
    </ul>
    {#if archivedLists.length > 0}
      <button class="self-start text-sm text-text-muted" onclick={() => (showArchived = !showArchived)} aria-expanded={showArchived}>
        {showArchived ? 'Hide' : 'Show'} archived ({archivedLists.length})
      </button>
      {#if showArchived}
        <ul class="flex flex-col gap-2 opacity-70">
          {#each archivedLists as t (t.id)}
            <li><a href="/trackables/{t.id}" use:link class="flex items-center gap-3 rounded-xl border p-3 text-sm border-border bg-surface text-text"><span class="text-xl">{t.icon}</span>{t.name}</a></li>
          {/each}
        </ul>
      {/if}
    {/if}
  {:else if view === 'list'}
    {#if items.length === 0}
      <p class="text-sm text-text-muted">Nothing in the next year.</p>
    {/if}
    {#each groups as g (g.label)}
      <section aria-label={g.label}>
        <h2 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{g.label}</h2>
        <ul class="flex flex-col gap-2">
          {#each g.items as d (dateItemKey(d))}{@render row(d)}{/each}
        </ul>
      </section>
    {/each}
  {:else}
    <section aria-label="Calendar" class="rounded-2xl border p-3 border-border bg-surface">
      <div class="mb-2 flex items-center justify-between">
        <button class="px-2 text-lg text-text-muted disabled:opacity-30" disabled={monthOffset === 0} onclick={() => monthOffset--} aria-label="Previous month">&lsaquo;</button>
        <h2 class="text-sm font-semibold text-text">{monthLabel}</h2>
        <button class="px-2 text-lg text-text-muted disabled:opacity-30" disabled={monthOffset === 11} onclick={() => monthOffset++} aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-[10px] text-text-muted">
        {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as w, i (i)}<span>{w}</span>{/each}
      </div>
      <div class="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="{monthLabel} days">
        {#each weeks as week, wi (wi)}
          {#each week as day, di (`${wi}-${di}`)}
            {#if day == null}
              <span></span>
            {:else}
              {@const dayItems = byDay.get(day) ?? []}
              <button
                class="flex aspect-square flex-col items-center justify-center rounded-lg text-xs"
                style="background: {selectedDay === day ? 'var(--color-surface-2)' : 'transparent'}; {day === today ? 'box-shadow: inset 0 0 0 1px var(--color-brand);' : ''} color: {day < today ? 'var(--color-text-muted)' : 'var(--color-text)'};"
                onclick={() => (selectedDay = day)}
                aria-label="{new Date(day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}{dayItems.length ? `, ${dayItems.length} ${dayItems.length === 1 ? 'date' : 'dates'}` : ''}"
                aria-pressed={selectedDay === day}
              >
                <span>{new Date(day).getDate()}</span>
                <span class="mt-0.5 flex h-1.5 gap-0.5">
                  {#each dayItems.slice(0, 3) as d (dateItemKey(d))}<span class="h-1.5 w-1.5 rounded-full" style="background: {d.color};"></span>{/each}
                </span>
              </button>
            {/if}
          {/each}
        {/each}
      </div>
    </section>
    {#if selectedDay != null}
      <section aria-label="Selected day">
        <h2 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{when(selectedDay)}</h2>
        {#if selectedItems.length === 0}
          <p class="text-sm text-text-muted">Nothing on this day.</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each selectedItems as d (dateItemKey(d))}{@render row(d)}{/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<QuickLogHost />

<BottomSheet bind:open={newOpen}>
  <EditTrackableSheet bind:open={newOpen} trackable={null} templates="dates" onSaved={(id) => push(`/trackables/${id}`)} />
</BottomSheet>
