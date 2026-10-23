<script lang="ts">
  import { onMount } from 'svelte';
  import { link } from 'svelte-spa-router';
  import SyncHistory from '../lib/components/SyncHistory.svelte';
  import HelpLink from '../lib/components/HelpLink.svelte';
  import { syncStore, HISTORY_DAYS, type ActivityEvent } from '../lib/stores/sync.svelte';
  import { describeCounts } from '../lib/utils/syncHistory';
  import { compareVersions, newestVersion } from '../lib/utils/version';

  // Everything about sync in one place (ARCHITECTURE.md 3.10): this device's
  // name, every device with its app version, the activity log shared by all
  // devices, and this device's own history. Linked from Settings > Sync and
  // the sync pill's history.

  const STATUS_LABELS: Record<typeof syncStore.status, string> = {
    idle: 'Synced',
    syncing: 'Syncing...',
    error: 'Sync error',
    offline: 'Offline',
    unauthenticated: 'Login expired',
    local: 'Local only: no sync server, so data stays on this device',
  };

  let nameDraft = $state('');
  let nameFilled = false;
  $effect(() => {
    if (nameFilled || !syncStore.deviceName) return;
    nameFilled = true;
    nameDraft = syncStore.deviceName;
  });

  let events = $state<ActivityEvent[]>([]);
  let more = $state(false);
  let activityError = $state<string | undefined>(undefined);
  let loadingActivity = $state(false);
  let expandedEvent = $state<number | null>(null);
  let deviceError = $state<string | undefined>(undefined);
  let checking = $state(false);
  let checkError = $state<string | undefined>(undefined);

  /** Runs Check sync or Full resync, then refreshes the activity. */
  async function run(action: () => Promise<void>) {
    checking = true;
    checkError = undefined;
    try {
      await action();
      await loadActivity();
    } catch {
      checkError = syncStore.lastError ?? 'The check could not run. Try again when you are online.';
    } finally {
      checking = false;
    }
  }

  async function loadActivity(older = false) {
    if (syncStore.status === 'local') return;
    loadingActivity = true;
    activityError = undefined;
    try {
      const page = await syncStore.loadActivity(older ? events[events.length - 1]?.at : undefined);
      events = older ? [...events, ...page.events] : page.events;
      more = page.more;
    } catch (err) {
      activityError = err instanceof Error && err.name === 'UnauthenticatedError' ? 'Log in again to see the activity.' : 'Could not load the activity. Try again when you are online.';
    } finally {
      loadingActivity = false;
    }
  }

  // Once on opening (an $effect would also rerun on every sync status change).
  onMount(() => {
    void loadActivity();
  });

  const thisVersion = __APP_VERSION__;
  const newest = $derived(newestVersion([thisVersion, ...syncStore.devices.map((d) => d.appVersion)]));
  const thisIsOld = $derived(!!newest && compareVersions(thisVersion, newest) < 0);

  function isOld(version: string | undefined): boolean {
    return !!version && !!newest && compareVersions(version, newest) < 0;
  }

  async function saveName() {
    await syncStore.renameDevice(nameDraft);
    nameDraft = syncStore.deviceName ?? nameDraft;
  }

  async function forget(id: string, name: string) {
    if (!confirm(`Remove ${name} from this list? It comes back if it syncs again. This doesn't sign it out.`)) return;
    deviceError = undefined;
    try {
      await syncStore.forgetDevice(id);
    } catch {
      deviceError = 'Could not remove it. Try again when you are online.';
    }
  }

  function ago(ts: number): string {
    const minutes = Math.floor((Date.now() - ts) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function when(ts: number): string {
    const d = new Date(ts);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  }

  function deviceName(id: string): string {
    if (id === syncStore.deviceId) return `${syncStore.deviceName ?? 'This device'} (this device)`;
    return syncStore.devices.find((d) => d.id === id)?.name ?? (id === 'unknown' ? 'An older app' : 'A removed device');
  }
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-6 px-5 py-6 lg:max-w-3xl">
  <div class="flex items-center gap-2">
    <a href="/settings" use:link class="text-sm text-text-muted" aria-label="Back to Settings">&larr; Settings</a>
  </div>
  <h1 class="flex items-center gap-2 text-xl font-semibold text-text"><span>Sync</span> <HelpLink topic="sync-page" label="the Sync page" /></h1>

  <section class="space-y-2 text-sm" aria-labelledby="sync-status">
    <h2 id="sync-status" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Status</h2>
    <div class="flex items-center justify-between gap-3">
      <span class="text-text">{syncStore.status === 'unauthenticated' && syncStore.signedOut ? 'Signed out' : STATUS_LABELS[syncStore.status]}{syncStore.lastSyncedAt && syncStore.status !== 'local' ? `, last synced ${ago(syncStore.lastSyncedAt)}` : ''}</span>
      {#if syncStore.status === 'unauthenticated'}
        <button class="rounded-lg px-3 py-1.5 text-sm font-semibold" style="background: var(--color-brand); color: #06140c;" onclick={() => syncStore.reauthenticate()}>Log in again</button>
      {:else if syncStore.status !== 'local'}
        <button class="rounded-lg border px-3 py-1.5 text-sm text-text-muted" style="border-color: var(--color-border);" onclick={() => syncStore.syncNow().then(() => loadActivity()).catch(() => {})}>Sync now</button>
      {/if}
    </div>
    {#if syncStore.status !== 'local'}
      <p class="text-xs text-text-muted">
        {syncStore.waiting === 0
          ? 'Nothing waiting: the server has every change from this device.'
          : `${syncStore.waiting} ${syncStore.waiting === 1 ? 'change' : 'changes'} on this device waiting to sync.`}
      </p>
    {/if}
  </section>

  <section class="space-y-2 text-sm" aria-labelledby="sync-this-device">
    <h2 id="sync-this-device" class="text-sm font-semibold uppercase tracking-wide text-text-muted">This device</h2>
    <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); void saveName(); }}>
      <label class="flex-1">
        <span class="sr-only">Device name</span>
        <input
          class="w-full rounded-lg border px-3 py-2 text-sm text-text"
          style="border-color: var(--color-border); background: var(--color-surface-2);"
          maxlength="40"
          bind:value={nameDraft}
          aria-label="Device name"
        />
      </label>
      <button
        type="submit"
        class="rounded-lg border px-3 py-1.5 text-sm text-text-muted"
        style="border-color: var(--color-border);"
        disabled={!nameDraft.trim() || nameDraft.trim() === syncStore.deviceName}>Rename</button
      >
    </form>
    <p class="text-xs text-text-muted">How this device appears in the device list and the activity. Version v{thisVersion}.</p>
    {#if thisIsOld}
      <p class="rounded-lg border p-2 text-xs text-amber-400" style="border-color: var(--color-border);">
        Another device runs v{newest}. Close and reopen the app here to update; an older version can clear settings the newer one added when it edits them.
      </p>
    {/if}
  </section>

  {#if syncStore.status !== 'local'}
    <section class="space-y-2 text-sm" aria-labelledby="sync-devices">
      <h2 id="sync-devices" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Your devices</h2>
      {#if syncStore.devices.length === 0}
        <p class="text-xs text-text-muted">Devices show here after they sync with v1.10.0 or later.</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each syncStore.devices as d (d.id)}
            <li class="flex items-center justify-between gap-3 rounded-lg border p-2" style="border-color: var(--color-border); background: var(--color-surface);">
              <div class="min-w-0">
                <p class="truncate text-text">{d.name}{d.id === syncStore.deviceId ? ' (this device)' : ''}</p>
                <p class="text-xs text-text-muted">
                  v{d.appVersion ?? '?'}, synced {ago(d.lastSeenAt)}
                  {#if isOld(d.appVersion)}
                    <span class="text-amber-400">&middot; older version: reopen the app on it to update</span>
                  {/if}
                </p>
              </div>
              {#if d.id !== syncStore.deviceId}
                <button class="shrink-0 text-xs text-text-muted underline" onclick={() => forget(d.id, d.name)} aria-label="Remove {d.name} from the list">Remove</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if deviceError}<p class="text-xs" style="color: #f87171;">{deviceError}</p>{/if}
    </section>

    <section class="space-y-2 text-sm" aria-labelledby="sync-activity">
      <h2 id="sync-activity" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Activity on all devices</h2>
      <p class="text-xs text-text-muted">Each sync that changed something, from any device, for 90 days: what kind of records and their names, never the values.</p>
      {#if activityError}
        <p class="text-xs" style="color: #f87171;">{activityError}</p>
      {:else if events.length === 0 && !loadingActivity}
        <p class="text-xs text-text-muted">No activity yet.</p>
      {/if}
      <ul class="flex flex-col gap-1">
        {#each events as e (e.id)}
          <li class="overflow-hidden rounded" style="background: var(--color-surface);">
            <button
              type="button"
              class="w-full px-2 py-1.5 text-left text-xs leading-snug"
              disabled={e.details.length === 0}
              onclick={() => (expandedEvent = expandedEvent === e.id ? null : e.id)}
            >
              <span class="font-medium text-text">{when(e.at)}</span>
              <span class="text-text-muted"> &middot; {deviceName(e.deviceId)}</span>
              <span class="block text-text-muted">
                {describeCounts(e.counts) || 'Nothing stored'}{e.rejectedCount ? `; ${e.rejectedCount} not synced` : ''}
              </span>
            </button>
            {#if expandedEvent === e.id}
              <ul class="border-t px-2 py-1 text-xs text-text-muted" style="border-color: var(--color-border);">
                {#each e.details as line, i (i)}<li>{line}</li>{/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      {#if more}
        <button class="text-xs font-semibold" style="color: var(--color-brand);" disabled={loadingActivity} onclick={() => loadActivity(true)}>Show older</button>
      {/if}
    </section>
  {/if}

  {#if syncStore.status !== 'local'}
    <section class="space-y-2 text-sm" aria-labelledby="sync-check">
      <h2 id="sync-check" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Check and repair</h2>
      <p class="text-xs text-text-muted">
        Check sync sends everything and compares how many records this device and the server have. Full resync also receives
        everything again from the start; it deletes nothing here first.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-lg border px-3 py-1.5 text-sm text-text-muted"
          style="border-color: var(--color-border);"
          disabled={checking}
          onclick={() => run(() => syncStore.checkSync())}>Check sync</button
        >
        <button
          class="rounded-lg border px-3 py-1.5 text-sm text-text-muted"
          style="border-color: var(--color-border);"
          disabled={checking}
          onclick={() => run(() => syncStore.fullResync())}>Full resync</button
        >
      </div>
      {#if checking}
        <p class="text-xs text-text-muted" role="status">Checking...</p>
      {:else if checkError}
        <p class="text-xs" style="color: #f87171;">{checkError}</p>
      {:else if syncStore.lastCheck}
        {@const c = syncStore.lastCheck}
        <div class="rounded-lg border p-2 text-xs" style="border-color: var(--color-border); background: var(--color-surface);" role="status">
          {#if c.unsupported}
            <p class="text-text-muted">The server is too old to count records. Update it with npm run deploy.</p>
          {:else}
            <p class="font-semibold" style="color: {c.matches ? 'var(--color-brand)' : '#f59e0b'};">
              {c.matches ? 'In sync: this device and the server have the same records.' : 'This device and the server differ.'}
            </p>
            <table class="mt-1 w-full text-left text-text-muted">
              <thead><tr><th class="font-normal"></th><th class="font-normal">Here</th><th class="font-normal">Server</th></tr></thead>
              <tbody>
                {#each c.rows as r (r.label)}
                  <tr class={r.here !== r.server ? 'text-amber-400' : ''}><td>{r.label}</td><td>{r.here}</td><td>{r.server}</td></tr>
                {/each}
              </tbody>
            </table>
            {#if !c.matches}
              <p class="mt-1 text-text-muted">
                {c.rejected > 0
                  ? `${c.rejected} ${c.rejected === 1 ? 'record' : 'records'} the server refused stay on this device only (see the history for why). `
                  : ''}A difference can also be a change another device made in the last moment. Full resync receives everything again.
              </p>
            {/if}
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <section class="space-y-2" aria-label="This device's syncs">
    <div class="rounded-lg border p-1.5" style="border-color: var(--color-border); background: var(--color-surface-2);">
      <SyncHistory title="This device's syncs, last {HISTORY_DAYS} days" />
    </div>
  </section>
</div>
