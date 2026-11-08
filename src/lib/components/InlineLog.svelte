<script lang="ts">
  import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
  import type { TrackableKind } from '../utils/trackableKinds';
  import { quickLog } from '../stores/quickLog.svelte';

  // Logging from Today without the sheet (3.55): a reading typed into a box
  // and Enter for a measurement, or a 1 to 5 tap for a rating check-in. Only
  // the first such field; the "+" opens the full sheet for the rest.
  let {
    trackable,
    fields,
    entries,
    kind,
  }: { trackable: TrackableDefinition; fields: FieldDefinition[]; entries: TrackableEntry[]; kind: TrackableKind } = $props();

  const numberField = $derived(kind === 'measurement' ? fields.find((f) => f.kind === 'number') : undefined);
  const ratingField = $derived(kind === 'checkin' ? fields.find((f) => f.kind === 'rating' && (f.ratingMax ?? 5) - (f.ratingMin ?? 1) <= 9) : undefined);
  const last = $derived.by(() => {
    if (!numberField) return undefined;
    const latest = entries.filter((e) => e.values?.[numberField.id] != null).sort((a, b) => b.timestamp - a.timestamp)[0];
    return latest ? String(latest.values![numberField.id]) : undefined;
  });

  let draft = $state('');
  let error = $state('');

  async function saveReading() {
    if (!numberField) return;
    const n = Number(draft.trim());
    if (!draft.trim() || Number.isNaN(n)) {
      error = `Enter a number for ${numberField.name}.`;
      return;
    }
    error = '';
    await quickLog.logValues(trackable, { [numberField.id]: n }, `Logged ${numberField.name} ${n}${numberField.unit ? ` ${numberField.unit}` : ''}`);
    draft = '';
  }

  async function rate(v: number) {
    if (!ratingField) return;
    await quickLog.logValues(trackable, { [ratingField.id]: v }, `Logged ${ratingField.name} ${v}`);
  }
</script>

{#if numberField}
  <form class="flex items-center gap-2 pl-12" onsubmit={(e) => (e.preventDefault(), saveReading())}>
    <label class="sr-only" for="inline-{trackable.id}">{numberField.name}{numberField.unit ? ` (${numberField.unit})` : ''}</label>
    <input
      id="inline-{trackable.id}"
      type="text"
      inputmode="decimal"
      bind:value={draft}
      placeholder={last ? `${numberField.name}: last ${last}` : numberField.name}
      class="w-full max-w-44 rounded-lg border border-border bg-transparent px-2 py-1 text-sm text-text placeholder:text-text-muted"
    />
    {#if numberField.unit}<span class="text-xs text-text-muted">{numberField.unit}</span>{/if}
    <button type="submit" class="rounded-lg px-2 py-1 text-xs font-semibold text-brand disabled:opacity-40" disabled={!draft.trim()}>Log</button>
  </form>
  {#if error}<p class="pl-12 text-xs text-danger" role="alert">{error}</p>{/if}
{:else if ratingField}
  {@const min = ratingField.ratingMin ?? 1}
  {@const max = ratingField.ratingMax ?? 5}
  <div class="flex flex-wrap items-center gap-1 pl-12" role="group" aria-label="{ratingField.name}, {min} to {max}">
    <span class="mr-1 text-xs text-text-muted">{ratingField.name}</span>
    {#each Array.from({ length: max - min + 1 }, (_, i) => min + i) as v (v)}
      <button
        class="flex h-7 w-7 items-center justify-center rounded-full border border-border text-xs text-text-muted hover:border-brand hover:text-brand"
        onclick={() => rate(v)}
        aria-label="{ratingField.name} {v}">{v}</button
      >
    {/each}
  </div>
{/if}
