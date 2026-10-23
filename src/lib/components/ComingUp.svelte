<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { TrackableDefinition, TrackableEntry } from '../db';
  import { attentionStore } from '../stores/attention.svelte';
  import { dateItemKey, upcomingDates } from '../utils/dates';

  // Trackables > Coming up: the next two weeks of dates from every dates
  // trackable (birthdays, anniversaries, holidays, countdowns), leaving out
  // those already under Needs attention. "See all" opens the Dates page.
  let { trackables, entries }: { trackables: TrackableDefinition[]; entries: TrackableEntry[] } = $props();

  const WITHIN_DAYS = 14;
  const SHOWN = 5;

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const datesTrackables = $derived(trackables.filter((t) => !t.archived && t.displayMode === 'ages'));
  const items = $derived.by(() => {
    const flagged = new Set(attentionStore.items.map((i) => i.key));
    return upcomingDates(datesTrackables, entries, now, WITHIN_DAYS).filter((d) => !flagged.has(dateItemKey(d)));
  });

  function when(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
</script>

{#if datesTrackables.length > 0}
  <section class="rounded-2xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);" aria-label="Coming up">
    <div class="mb-1 flex items-baseline justify-between gap-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-text-muted">Coming up</p>
      <a href="/dates" use:link class="text-xs font-semibold" style="color: var(--color-brand);">See all dates</a>
    </div>
    {#if items.length === 0}
      <p class="px-1 py-1 text-sm text-text-muted">Nothing else in the next {WITHIN_DAYS} days.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each items.slice(0, SHOWN) as d (dateItemKey(d))}
          <li>
            <a href="/trackables/{d.trackableId}" use:link class="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
              <span class="w-6 text-center">{d.icon}</span>
              <span class="min-w-0 flex-1 truncate text-text">{d.name}{d.detail ? `: ${d.detail}` : ''}</span>
              <span class="shrink-0 text-xs text-text-muted">{when(d.at)}, {d.countdown.toLowerCase()}</span>
            </a>
          </li>
        {/each}
      </ul>
      {#if items.length > SHOWN}
        <p class="px-1 pt-1 text-xs text-text-muted">+{items.length - SHOWN} more in the next {WITHIN_DAYS} days</p>
      {/if}
    {/if}
  </section>
{/if}
