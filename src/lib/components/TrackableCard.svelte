<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db, type TrackableDefinition } from '../db';
  import { formatTimeSinceAdaptive } from '../utils/trackableStats';
  import { daysUntilNextBirthday, formatBirthdayCountdown } from '../utils/age';

  let { trackable, onQuickLog }: { trackable: TrackableDefinition; onQuickLog: () => void } = $props();

  const isAges = $derived(trackable.displayMode === 'ages');

  const entries = liveQuery(() => db.trackableEntries.where('trackableId').equals(trackable.id).toArray());

  const lastEntry = $derived(
    ($entries ?? []).reduce<{ timestamp: number } | null>(
      (latest, e) => (!latest || e.timestamp > latest.timestamp ? e : latest),
      null,
    ),
  );

  const timeSince = $derived(lastEntry ? formatTimeSinceAdaptive(Date.now() - lastEntry.timestamp) : null);

  const nextUp = $derived(
    ($entries ?? [])
      .map((e) => ({ name: e.note?.trim() || 'Someone', daysUntil: daysUntilNextBirthday(e.timestamp) }))
      .sort((a, b) => a.daysUntil - b.daysUntil)[0] ?? null,
  );

  const subtitle = $derived(
    isAges
      ? nextUp
        ? `\u{1F382} ${nextUp.name}'s birthday ${formatBirthdayCountdown(nextUp.daysUntil)}`
        : 'No one added yet'
      : timeSince
        ? `${timeSince} ago`
        : 'No entries yet',
  );
</script>

<div class="flex items-center gap-3 rounded-2xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
  <a href="/trackables/{trackable.id}" use:link class="flex flex-1 items-center gap-3 overflow-hidden">
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style="background: {trackable.color}22;">
      {trackable.icon}
    </span>
    <div class="overflow-hidden">
      <p class="truncate text-sm font-medium text-text">{trackable.name}</p>
      <p class="truncate text-xs text-text-muted">{subtitle}</p>
    </div>
  </a>
  <button
    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
    style="background: {trackable.color}22; color: {trackable.color};"
    onclick={onQuickLog}
    aria-label="Log {trackable.name}"
  >+</button>
</div>
