<script lang="ts">
  import type { FieldDefinition, TrackableEntry } from '../db';
  import { fieldUnitLabel } from '../utils/metrics';
  import { formatDateTime, toDatetimeLocal } from '../utils/time';
  import CopyButton from './CopyButton.svelte';

  let {
    entries,
    fields,
    onSelect,
  }: { entries: TrackableEntry[]; fields: FieldDefinition[]; onSelect: (entry: TrackableEntry) => void } = $props();

  const PAGE_SIZE = 50;
  let limit = $state(PAGE_SIZE);

  const shown = $derived(entries.slice(0, limit));
  const hasNotes = $derived(entries.some((e) => e.note?.trim()));

  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function display(raw: number | boolean | undefined): string {
    if (raw == null) return '\u2013';
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    return nf.format(raw);
  }

  function toTsv(): string {
    const header = ['When', ...fields.map((f) => (f.unit ? `${f.name} (${f.unit})` : f.name)), 'Note'];
    const lines = [header.join('\t')];
    for (const e of entries) {
      lines.push(
        [
          toDatetimeLocal(e.timestamp).replace('T', ' '),
          ...fields.map((f) => {
            const v = e.values?.[f.id];
            return v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
          }),
          (e.note ?? '').replace(/\s+/g, ' ').trim(),
        ].join('\t'),
      );
    }
    return lines.join('\n');
  }
</script>

<div class="rounded-2xl border" style="border-color: var(--color-border); background: var(--color-surface);">
  <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
    <p class="text-sm font-medium text-text-muted">Entries <span class="text-xs">({entries.length})</span></p>
    {#if entries.length > 0}
      <CopyButton getText={toTsv} />
    {/if}
  </div>

  {#if entries.length === 0}
    <p class="px-3 pb-4 text-sm text-text-muted">No entries yet.</p>
  {:else}
    <div class="max-h-[60vh] overflow-auto {entries.length > limit ? '' : 'rounded-b-2xl'}">
      <table class="w-full border-separate border-spacing-0 tabular-nums">
        <thead>
          <tr>
            <th
              class="sticky left-0 top-0 z-20 bg-surface px-3 py-1.5 text-left align-bottom text-[10px] font-semibold uppercase tracking-wide text-text-muted"
            >When</th>
            {#each fields as f (f.id)}
              <th class="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom">
                <span class="block whitespace-nowrap text-xs font-semibold text-text">{f.name}</span>
                <span class="block h-3.5 text-[10px] font-normal text-text-muted">{fieldUnitLabel(f) ?? ''}</span>
              </th>
            {/each}
            {#if hasNotes}
              <th
                class="sticky top-0 z-10 bg-surface px-3 py-1.5 text-left align-bottom text-[10px] font-semibold uppercase tracking-wide text-text-muted"
              >Note</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each shown as entry (entry.id)}
            <!-- Whole row is a tap target for touch; the date button keeps it keyboard-accessible (its click bubbles here). -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
            <tr class="cursor-pointer" onclick={() => onSelect(entry)}>
              <th scope="row" class="sticky left-0 z-10 whitespace-nowrap border-t border-border bg-surface px-3 py-2 text-left font-normal">
                <button type="button" class="text-left text-sm text-text">{formatDateTime(entry.timestamp)}</button>
              </th>
              {#each fields as f (f.id)}
                <td
                  class="whitespace-nowrap border-t border-border px-2 py-2 text-right text-sm {entry.values?.[f.id] == null
                    ? 'text-text-muted'
                    : 'text-text'}"
                >{display(entry.values?.[f.id])}</td>
              {/each}
              {#if hasNotes}
                <td class="max-w-[12rem] truncate border-t border-border px-3 py-2 text-left text-xs text-text-muted" title={entry.note ?? ''}>
                  {entry.note ?? ''}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if entries.length > limit}
      <button
        type="button"
        class="w-full rounded-b-2xl border-t border-border py-2 text-xs font-medium text-text-muted"
        onclick={() => (limit += PAGE_SIZE)}
      >Show {Math.min(PAGE_SIZE, entries.length - limit)} more</button>
    {/if}
  {/if}
</div>
