<script lang="ts">
  import { liveQuery } from 'dexie';
  import { addTrackableEntry, db } from '../db';
  import { settingsStore } from '../stores/settings.svelte';
  import { resolveBodyFieldIds } from '../utils/health';
  import { newWeighIns, parseScaleCsv, type ScaleRow, type WeightUnit } from '../utils/scaleImport';
  import { formatShortDate } from '../utils/time';
  import Button from './ui/Button.svelte';

  // Settings > Your data > Weigh-ins from a scale app (utils/scaleImport.ts):
  // a CSV export from Renpho, Withings, Fitbit, Garmin and the like becomes
  // entries of the weight field's trackable, with a preview first and the
  // days already logged left out.
  const fields = liveQuery(() => db.fieldDefinitions.toArray());
  const trackables = liveQuery(() => db.trackableDefinitions.toArray());

  const weightField = $derived.by(() => {
    const id = resolveBodyFieldIds($fields ?? [], settingsStore.data).weight;
    return id ? ($fields ?? []).find((f) => f.id === id) : undefined;
  });
  const holder = $derived(
    weightField ? ($trackables ?? []).filter((t) => t.fieldIds.includes(weightField.id)).sort((a, b) => Number(!!a.archived) - Number(!!b.archived))[0] : undefined,
  );
  const targetUnit = $derived<WeightUnit>(weightField?.unit === 'kg' ? 'kg' : weightField?.unit === 'st' ? 'st' : 'lb');

  let fileInput: HTMLInputElement | undefined = $state();
  let preview = $state.raw<{ add: ScaleRow[]; duplicates: number; skipped: number; from: string; columns: string; converted: boolean } | null>(null);
  let message = $state('');
  let error = $state('');
  let busy = $state(false);

  async function readFile(file: File) {
    message = '';
    error = '';
    preview = null;
    if (!weightField || !holder) return;
    const parsed = parseScaleCsv(await file.text(), targetUnit);
    if (typeof parsed === 'string') {
      error = parsed;
      return;
    }
    const own = await db.trackableEntries.where('trackableId').equals(holder.id).toArray();
    const existing = own.filter((e) => typeof e.values?.[weightField.id] === 'number').map((e) => ({ timestamp: e.timestamp, value: e.values![weightField.id] as number }));
    const { add, duplicates } = newWeighIns(parsed.rows, existing);
    preview = {
      add,
      duplicates,
      skipped: parsed.skipped,
      from: add.length ? `${formatShortDate(add[0].timestamp)} to ${formatShortDate(add[add.length - 1].timestamp)}` : '',
      columns: `${parsed.columns.date}${parsed.columns.time ? ` + ${parsed.columns.time}` : ''}, ${parsed.columns.weight}`,
      converted: parsed.sourceUnit !== targetUnit,
    };
  }

  async function importRows() {
    if (!preview || !weightField || !holder) return;
    busy = true;
    try {
      for (const r of preview.add) {
        await addTrackableEntry({ trackableId: holder.id, timestamp: r.timestamp, values: { [weightField.id]: r.value } });
      }
      message = `Imported ${preview.add.length} ${preview.add.length === 1 ? 'weigh-in' : 'weigh-ins'} into ${holder.name}.`;
      preview = null;
      if (fileInput) fileInput.value = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Import failed.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-2 rounded-lg border border-border p-3" aria-label="Weigh-ins from a scale app" role="group">
  <p class="text-sm font-medium text-text">Weigh-ins from a scale app</p>
  {#if !weightField || !holder}
    <p class="text-xs text-text-muted">Set a weight field under Body first; weigh-ins are added to its trackable.</p>
  {:else}
    <p class="text-xs text-text-muted">
      A CSV export from Renpho, Withings, Fitbit, Garmin, Eufy or Google Fit. Weigh-ins go into {holder.name}'s {weightField.name}, converted to
      {targetUnit}; days you already logged with the same weight are left out.
    </p>
    <input
      bind:this={fileInput}
      type="file"
      accept=".csv,text/csv"
      aria-label="Scale CSV file"
      class="block w-full text-xs text-text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-text"
      onchange={(e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void readFile(f);
      }}
    />
    {#if preview}
      <div class="rounded-lg bg-surface-2 p-2 text-xs text-text">
        {#if preview.add.length}
          <p><strong>{preview.add.length}</strong> new {preview.add.length === 1 ? 'weigh-in' : 'weigh-ins'}, {preview.from}{preview.converted ? `, converted to ${targetUnit}` : ''}.</p>
        {:else}
          <p>Nothing new: every weigh-in in the file is already here.</p>
        {/if}
        <p class="text-text-muted">
          Columns: {preview.columns}.{preview.duplicates ? ` ${preview.duplicates} already here.` : ''}{preview.skipped ? ` ${preview.skipped} rows couldn't be read.` : ''}
        </p>
      </div>
      {#if preview.add.length}
        <Button variant="primary" size="sm" disabled={busy} onclick={importRows}>Import {preview.add.length} {preview.add.length === 1 ? 'weigh-in' : 'weigh-ins'}</Button>
      {/if}
    {/if}
    {#if message}<p class="text-xs text-brand" role="status">{message}</p>{/if}
    {#if error}<p class="text-xs text-danger" role="alert">{error}</p>{/if}
  {/if}
</div>
