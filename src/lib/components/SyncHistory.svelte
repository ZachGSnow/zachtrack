<script lang="ts">
  import { syncStore } from '../stores/sync.svelte';
  import type { SyncHistoryEntry } from '../utils/syncHistory';

  // The last few syncs on this device (ARCHITECTURE.md 3.10): shown from a double-tap on the
  // sync pill and on the Settings page.
  let expandedEntryAt = $state<number | null>(null);

  function formatEntryTime(ts: number): string {
    const date = new Date(ts);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return isToday ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  }

  /** "9:02 AM", or "9:02 AM to 1:40 PM (14 syncs)" for identical syncs kept as one entry. */
  function formatWhen(entry: SyncHistoryEntry): string {
    if (!entry.repeat || !entry.firstAt) return formatEntryTime(entry.completedAt);
    return `${formatEntryTime(entry.firstAt)} to ${formatEntryTime(entry.completedAt)} (${entry.repeat} syncs)`;
  }

  function formatDuration(ms: number | undefined): string {
    if (ms == null) return '';
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  function dotColor(outcome: 'success' | 'error' | 'offline' | 'local'): string {
    if (outcome === 'error') return '#ef4444';
    if (outcome === 'offline') return '#eab308';
    if (outcome === 'local') return 'var(--color-text-muted)';
    return 'var(--color-brand-dim)';
  }

  function toggleEntryDetails(completedAt: number) {
    expandedEntryAt = expandedEntryAt === completedAt ? null : completedAt;
  }
</script>

<p class="px-1 pb-1 text-left text-[10px] font-semibold opacity-70" style="color: var(--color-text-muted);">
  Recent syncs
</p>
{#if syncStore.history.length === 0}
  <p class="px-1 py-1 text-left text-[10px]" style="color: var(--color-text-muted);">No sync history yet.</p>
{:else}
  <ul class="flex flex-col gap-1">
    {#each syncStore.history as entry (entry.completedAt)}
      {@const hasDetails = !!entry.details?.length || !!entry.sentDetails?.length || !!entry.rejectedDetails?.length}
      <li class="overflow-hidden rounded" style="background: var(--color-surface);">
        <button
          type="button"
          disabled={!hasDetails}
          onclick={() => toggleEntryDetails(entry.completedAt)}
          class="w-full px-1.5 py-1 text-left text-[10px] leading-snug"
          style="cursor: {hasDetails ? 'pointer' : 'default'};"
        >
          <span class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background: {dotColor(entry.outcome)};"
            ></span>
            <span class="font-medium" style="color: var(--color-text);">{formatWhen(entry)}</span>
            {#if entry.durationMs != null && !entry.repeat}
              <span class="opacity-60" style="color: var(--color-text-muted);">{formatDuration(entry.durationMs)}{entry.full ? ', full check' : ''}</span>
            {/if}
            {#if hasDetails}
              <span class="ml-auto shrink-0 opacity-60" style="color: var(--color-text-muted);"
                >{expandedEntryAt === entry.completedAt ? '\u25be' : '\u25b8'}</span
              >
            {/if}
          </span>
          <span class="mt-0.5 block break-words opacity-80" style="color: var(--color-text-muted);">
            {entry.outcome === 'error' ? (entry.error ?? entry.summary) : entry.summary}
          </span>
        </button>
        {#if entry.rejectedCount > 0}
          <p class="px-1.5 pb-1 text-left text-[10px] text-amber-400">
            &#x26A0; {entry.rejectedCount} not synced{entry.rejectedDetails?.length ? ' (tap for why)' : ''}
          </p>
        {/if}
        {#if hasDetails && expandedEntryAt === entry.completedAt}
          <ul
            class="flex flex-col gap-0.5 border-t px-1.5 py-1 text-left text-[10px]"
            style="border-color: var(--color-border);"
          >
            {#each entry.rejectedDetails ?? [] as line, i (i)}
              <li class="break-words text-amber-400">{line}</li>
            {/each}
            {#if entry.rejectedDetails && entry.rejectedCount > entry.rejectedDetails.length}
              <li class="italic text-amber-400 opacity-80">
                +{entry.rejectedCount - entry.rejectedDetails.length} more not synced
              </li>
            {/if}
            {#if entry.sentDetails?.length}
              <li class="font-semibold opacity-70" style="color: var(--color-text-muted);">Sent</li>
              {#each entry.sentDetails as line, i (i)}
                <li class="break-words opacity-80" style="color: var(--color-text-muted);">{line}</li>
              {/each}
              {#if entry.moreSentCount}
                <li class="italic opacity-60" style="color: var(--color-text-muted);">+{entry.moreSentCount} more</li>
              {/if}
            {/if}
            {#if entry.details?.length}
              {#if entry.sentDetails?.length}
                <li class="font-semibold opacity-70" style="color: var(--color-text-muted);">Received</li>
              {/if}
              {#each entry.details as line, i (i)}
                <li class="break-words opacity-80" style="color: var(--color-text-muted);">{line}</li>
              {/each}
              {#if entry.moreDetailsCount}
                <li class="italic opacity-60" style="color: var(--color-text-muted);">
                  +{entry.moreDetailsCount} more
                </li>
              {/if}
            {/if}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
