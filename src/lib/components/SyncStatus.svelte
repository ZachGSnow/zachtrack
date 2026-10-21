<script lang="ts">
  import { syncStore } from '../stores/sync.svelte';

  let expanded = $state(false);
  let showHistory = $state(false);
  let expandedEntryAt = $state<number | null>(null);
  let now = $state(Date.now());
  let lastClickAt = 0;
  let container: HTMLDivElement | undefined;
  const DOUBLE_CLICK_MS = 350;

  $effect(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 15_000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    if (!showHistory) return;
    function handleOutsideClick(event: MouseEvent) {
      if (container && !container.contains(event.target as Node)) {
        showHistory = false;
      }
    }
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  });

  const statusLabel = $derived(
    {
      idle: 'Synced',
      syncing: 'Syncing\u2026',
      error: 'Sync error',
      offline: 'Offline',
      unauthenticated: 'Login expired',
    }[syncStore.status],
  );

  const isUnauthenticated = $derived(syncStore.status === 'unauthenticated');
  // The login-expired panel is always shown (it's the only way back to a working
  // sync); other errors still require a tap on the pill to expand.
  const showErrorPanel = $derived(!!syncStore.lastError && (expanded || isUnauthenticated));

  const timeAgo = $derived(formatTimeAgo(syncStore.lastSyncedAt, now));

  function formatTimeAgo(ts: number | undefined, nowMs: number): string {
    if (!ts) return 'never synced';
    const seconds = Math.floor((nowMs - ts) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function formatEntryTime(ts: number): string {
    const date = new Date(ts);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return isToday ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  }

  function dotColor(outcome: 'success' | 'error' | 'offline'): string {
    if (outcome === 'error') return '#ef4444';
    if (outcome === 'offline') return '#eab308';
    return 'var(--color-brand-dim)';
  }

  function toggleEntryDetails(completedAt: number) {
    expandedEntryAt = expandedEntryAt === completedAt ? null : completedAt;
  }

  function handleClick() {
    const clickedAt = Date.now();
    const isDoubleClick = clickedAt - lastClickAt < DOUBLE_CLICK_MS;
    lastClickAt = clickedAt;

    if (isDoubleClick) {
      expanded = false;
      showHistory = !showHistory;
      return;
    }

    showHistory = false;
    if (syncStore.status === 'error' || syncStore.status === 'offline') {
      expanded = !expanded;
    }
    // Still worth retrying when unauthenticated: if the user logged in again via
    // a regular browser tab, the cookie is shared and this will just succeed.
    syncStore.syncNow().catch(() => {});
  }

  function handleReauthenticate(event: MouseEvent) {
    event.stopPropagation();
    syncStore.reauthenticate();
  }
</script>

<div class="relative flex flex-col items-end gap-1" bind:this={container}>
  <button
    type="button"
    onclick={handleClick}
    aria-busy={syncStore.status === 'syncing'}
    class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
    style="border-color: var(--color-border); color: var(--color-text-muted); background: var(--color-surface-2); cursor: {syncStore.status === 'syncing' ? 'wait' : 'pointer'};"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      style="background: {syncStore.status === 'error' || isUnauthenticated
        ? '#ef4444'
        : syncStore.status === 'offline'
          ? '#eab308'
          : syncStore.status === 'syncing'
            ? 'var(--color-brand)'
            : 'var(--color-brand-dim)'};"
    ></span>
    <span>{statusLabel}</span>
    {#if syncStore.status !== 'syncing'}
      <span class="opacity-70">&middot; {timeAgo}</span>
    {/if}
    {#if syncStore.rejected.length > 0}
      <span class="text-amber-400">&#x26A0; {syncStore.rejected.length}</span>
    {/if}
  </button>
  {#if showErrorPanel}
    <div
      class="flex max-w-[240px] flex-col items-end gap-1.5 rounded-md border px-2 py-1 text-right text-[10px] leading-snug break-words"
      style="border-color: var(--color-border); color: #ef4444; background: var(--color-surface-2);"
    >
      <p>{syncStore.lastError}</p>
      {#if isUnauthenticated}
        <button
          type="button"
          onclick={handleReauthenticate}
          class="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style="background: var(--color-brand); color: var(--color-bg);"
        >
          Log in again
        </button>
      {/if}
    </div>
  {/if}
  {#if showHistory}
    <div
      class="absolute top-full z-10 mt-1 w-64 rounded-md border p-1.5 text-right"
      style="border-color: var(--color-border); background: var(--color-surface-2);"
    >
      <p class="px-1 pb-1 text-left text-[10px] font-semibold opacity-70" style="color: var(--color-text-muted);">
        Recent syncs
      </p>
      {#if syncStore.history.length === 0}
        <p class="px-1 py-1 text-left text-[10px]" style="color: var(--color-text-muted);">No sync history yet.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each syncStore.history as entry (entry.completedAt)}
            {@const hasDetails = !!entry.details && entry.details.length > 0}
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
                  <span class="font-medium" style="color: var(--color-text);">{formatEntryTime(entry.completedAt)}</span>
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
                <p class="px-1.5 pb-1 text-[10px] text-amber-400">&#x26A0; {entry.rejectedCount} rejected</p>
              {/if}
              {#if hasDetails && expandedEntryAt === entry.completedAt}
                <ul
                  class="flex flex-col gap-0.5 border-t px-1.5 py-1 text-[10px]"
                  style="border-color: var(--color-border);"
                >
                  {#each entry.details ?? [] as line (line)}
                    <li class="break-words opacity-80" style="color: var(--color-text-muted);">{line}</li>
                  {/each}
                  {#if entry.moreDetailsCount}
                    <li class="italic opacity-60" style="color: var(--color-text-muted);">
                      +{entry.moreDetailsCount} more
                    </li>
                  {/if}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
