<script lang="ts">
  import { getAllSyncableRecords, importRecords } from '../db';
  import { buildCsv, buildExport, csvFileName, exportFileName, planImport, type ImportPlan } from '../dataFile';

  // $state.raw, not $state: the plan's records go straight into IndexedDB,
  // which can't clone Svelte's deep proxies (ARCHITECTURE.md 4.4). The plan is
  // only ever replaced, never edited in place.
  let plan = $state.raw<ImportPlan | null>(null);
  let message = $state<string | undefined>(undefined);
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const pluralize = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

  /** Hands text to the browser as a file download. */
  function download(text: string, name: string, type: string): void {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before freeing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function exportData() {
    error = undefined;
    message = undefined;
    try {
      const now = new Date();
      const file = buildExport(await getAllSyncableRecords(), now);
      download(JSON.stringify(file, null, 2), exportFileName(now), 'application/json');
      const d = file.data;
      message = `Exported ${pluralize(d.fasts.length, 'fast')}, ${pluralize(d.trackableEntries.length, 'entry', 'entries')} and ${pluralize(d.trackableDefinitions.length, 'trackable')}.`;
    } catch (err) {
      error = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Entries and fasts as CSV for a spreadsheet; the JSON export stays the one to restore from. */
  async function exportCsv() {
    error = undefined;
    message = undefined;
    try {
      const now = new Date();
      download(buildCsv(await getAllSyncableRecords()), csvFileName(now), 'text/csv');
      message = 'Exported a CSV of your entries and fasts, one row per value.';
    } catch (err) {
      error = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = undefined;
    message = undefined;
    plan = null;
    try {
      const result = planImport(await file.text(), await getAllSyncableRecords());
      if (result.ok) plan = result.plan;
      else error = result.error;
    } catch (err) {
      error = `Could not read the file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function confirmImport() {
    if (!plan) return;
    busy = true;
    try {
      await importRecords(plan.changes);
      message = `Imported: ${plan.added} added, ${plan.updated} updated. It will sync to your other devices.`;
      plan = null;
    } catch (err) {
      error = `Import failed, nothing was changed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy = false;
    }
  }

  const exportedOn = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'an unknown date');
</script>

<section class="space-y-2 rounded-lg border p-3 text-sm" style="border-color: var(--color-border);">
  <h3 class="font-semibold text-text">Your data</h3>
  <p class="text-xs text-text-muted">
    Export saves everything on this device as a JSON file. It is plain text health data: keep it somewhere private.
  </p>

  <div class="flex gap-2">
    <button
      type="button"
      class="flex-1 rounded-lg border py-2"
      style="border-color: var(--color-border);"
      onclick={exportData}>Export data</button
    >
    <button
      type="button"
      class="flex-1 rounded-lg border py-2"
      style="border-color: var(--color-border);"
      onclick={() => fileInput?.click()}>Import file</button
    >
    <input bind:this={fileInput} type="file" accept="application/json,.json" class="hidden" onchange={chooseFile} />
  </div>
  <button type="button" class="w-full rounded-lg border py-2" style="border-color: var(--color-border);" onclick={exportCsv}
    >Export CSV for a spreadsheet</button
  >

  {#if plan}
    <div class="space-y-2 rounded-lg p-2" style="background: var(--color-surface-2);" role="status">
      <p class="text-text">Export from {exportedOn(plan.exportedAt)}</p>
      <ul class="text-xs text-text-muted">
        <li>{pluralize(plan.added, 'new record')} to add</li>
        <li>{pluralize(plan.updated, 'record')} to update to the file's newer version</li>
        <li>{pluralize(plan.unchanged, 'record')} already here with the same or a newer version, left alone</li>
        {#if plan.skipped.length}
          <li class="text-amber-400">{plan.skipped.length} skipped:</li>
          {#each plan.skipped.slice(0, 5) as s, i (i)}
            <li class="pl-2 text-amber-400">{s.recordType} {s.id}: {s.reason}</li>
          {/each}
          {#if plan.skipped.length > 5}
            <li class="pl-2 text-amber-400">+{plan.skipped.length - 5} more</li>
          {/if}
        {/if}
      </ul>
      <p class="text-xs text-text-muted">Nothing on this device is deleted.</p>
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-lg py-2 font-semibold"
          style="background: var(--color-brand); color: #06140c;"
          disabled={busy || plan.added + plan.updated === 0}
          onclick={confirmImport}>{plan.added + plan.updated === 0 ? 'Nothing to import' : 'Import'}</button
        >
        <button
          type="button"
          class="flex-1 rounded-lg border py-2"
          style="border-color: var(--color-border);"
          onclick={() => (plan = null)}>Cancel</button
        >
      </div>
    </div>
  {/if}

  {#if message}<p class="text-xs text-text" role="status">{message}</p>{/if}
  {#if error}<p class="text-xs text-amber-400" role="alert">{error}</p>{/if}
</section>
