<script lang="ts">
  import { link } from 'svelte-spa-router';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import { syncStore } from '../stores/sync.svelte';
  import { assessDataSafety } from '../utils/dataSafety';
  import { downloadBackupFile, lastExportAt } from '../exportData';

  // "Your data" on Today (utils/dataSafety.ts): one line when all is well,
  // the details and an export button when something needs a look.
  let { now }: { now: number } = $props();

  let exportedAt = $state(lastExportAt());
  let open = $state(false);

  $effect(() => {
    // The server's last nightly backup, once a sync has worked.
    if (syncStore.status === 'idle' && syncStore.backup === undefined) void syncStore.loadBackupStatus();
  });

  const safety = $derived(
    assessDataSafety({
      syncStatus: syncStore.status,
      lastSyncedAt: syncStore.lastSyncedAt,
      waiting: syncStore.waiting,
      backupConfigured: syncStore.backup?.configured,
      backupAt: syncStore.backup?.at,
      lastExportAt: exportedAt,
      now,
    }),
  );
  const expanded = $derived(open || !safety.ok);

  let busy = $state(false);
  async function exportNow() {
    busy = true;
    try {
      await downloadBackupFile();
      exportedAt = lastExportAt();
    } finally {
      busy = false;
    }
  }
</script>

<section class="rounded-2xl border px-3 py-2 {safety.ok ? 'border-border bg-surface' : 'border-warn/35 bg-warn-soft'}" aria-label="Your data">
  <button class="flex w-full items-center gap-2 text-left text-sm" onclick={() => (open = !open)} aria-expanded={expanded}>
    {#if safety.ok}
      <ShieldCheck size={18} class="shrink-0 text-brand" aria-hidden="true" />
      <span class="flex-1 text-text">Your data is safe</span>
    {:else}
      <ShieldAlert size={18} class="shrink-0 text-warn" aria-hidden="true" />
      <span class="flex-1 font-medium text-text">Your data needs a look</span>
    {/if}
    <span class="text-xs text-text-muted">{expanded ? 'Hide' : 'Details'}</span>
  </button>
  {#if expanded}
    <ul class="mt-1 flex flex-col gap-0.5 pl-6 text-xs">
      {#each safety.lines as line (line.text)}
        <li class={line.tone === 'warn' ? 'font-medium text-warn' : 'text-text-muted'}>{line.text}</li>
      {/each}
    </ul>
    <div class="mt-2 flex items-center gap-3 pl-6 text-xs">
      <button class="font-semibold text-brand disabled:opacity-50" disabled={busy} onclick={exportNow}>Export a backup file</button>
      <a href="/sync" use:link class="text-text-muted">Sync details</a>
    </div>
  {/if}
</section>
