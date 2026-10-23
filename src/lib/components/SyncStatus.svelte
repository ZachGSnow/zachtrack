<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { syncStore } from '../stores/sync.svelte';
  import SyncHistory from './SyncHistory.svelte';

  // 'end' in the phone header (right-aligned), 'start' in the laptop sidebar.
  let { align = 'end' }: { align?: 'start' | 'end' } = $props();

  let expanded = $state(false);
  let showHistory = $state(false);
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
      local: 'Local only',
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

<div class="relative flex flex-col gap-1 {align === 'end' ? 'items-end' : 'items-start'}" bind:this={container}>
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
            : syncStore.status === 'local'
              ? 'var(--color-text-muted)'
              : 'var(--color-brand-dim)'};"
    ></span>
    <span title={syncStore.status === 'local' ? 'No sync server: data stays on this device' : undefined}>{statusLabel}</span>
    {#if syncStore.status !== 'syncing' && syncStore.status !== 'local'}
      <span class="opacity-70">&middot; {timeAgo}</span>
    {/if}
    <!-- Only when a sync can't run: right after an edit the count would just flicker before the sync. -->
    {#if syncStore.waiting > 0 && (syncStore.status === 'offline' || syncStore.status === 'error' || isUnauthenticated)}
      <span class="text-amber-400">&middot; {syncStore.waiting} waiting</span>
    {/if}
    {#if syncStore.rejected.length > 0}
      <span
        class="text-amber-400"
        title={`Not synced (double-tap for details):\n${syncStore.rejectedDetails.join('\n')}`}
        aria-label={`${syncStore.rejected.length} not synced`}>&#x26A0; {syncStore.rejected.length}</span
      >
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
      <SyncHistory limit={5} />
      <a
        href="/sync"
        use:link
        onclick={() => (showHistory = false)}
        class="mt-1 block px-1 text-left text-[10px] font-semibold"
        style="color: var(--color-brand);">All syncs, devices and activity</a
      >
    </div>
  {/if}
</div>
