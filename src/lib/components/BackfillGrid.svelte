<script lang="ts">
  import { addTrackableEntry, type FieldDefinition, type TrackableDefinition, type TrackableEntry } from '../db';
  import { backfillDays, backfillEntries, invalidCell, loggedByDay, type BackfillRow } from '../utils/backfill';
  import Button from './ui/Button.svelte';

  // "Fill in past days" (ARCHITECTURE.md 3.58): a table of the last week or
  // two, one cell per field, saved as one entry at noon for each filled day.
  let { trackable, fields, entries }: { trackable: TrackableDefinition; fields: FieldDefinition[]; entries: TrackableEntry[] } = $props();

  let open = $state(false);
  let span = $state<7 | 14>(7);
  let rows = $state<BackfillRow[]>([]);
  let status = $state('');
  let busy = $state(false);

  function reset() {
    rows = backfillDays(Date.now(), span).map((day) => ({ day, values: Object.fromEntries(fields.map((f) => [f.id, f.kind === 'boolean' ? false : ''])), done: false }));
  }
  $effect(() => {
    if (open && rows.length !== span) reset();
  });

  const logged = $derived(loggedByDay(entries, rows.map((r) => r.day)));
  const toAdd = $derived(backfillEntries(trackable.id, rows, fields));
  const invalid = $derived(rows.some((r) => fields.some((f) => invalidCell(f, r.values[f.id]))));
  const dayLabel = (d: number) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  async function save() {
    busy = true;
    try {
      for (const e of toAdd) await addTrackableEntry(e);
      status = `Added ${toAdd.length} ${toAdd.length === 1 ? 'entry' : 'entries'}.`;
      reset();
    } finally {
      busy = false;
    }
  }
</script>

<details class="rounded-2xl border border-border bg-surface p-4" bind:open>
  <summary class="cursor-pointer text-sm font-medium text-text">Fill in past days</summary>
  {#if open}
    <div class="mt-3 flex flex-col gap-3">
      <div class="flex items-center gap-2 text-xs text-text-muted">
        <span>Show the last</span>
        <button type="button" class="rounded-md px-2 py-0.5 {span === 7 ? 'bg-surface-2 text-text' : ''}" aria-pressed={span === 7} onclick={() => (span = 7)}>7 days</button>
        <button type="button" class="rounded-md px-2 py-0.5 {span === 14 ? 'bg-surface-2 text-text' : ''}" aria-pressed={span === 14} onclick={() => (span = 14)}>14 days</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm" aria-label="Fill in past days for {trackable.name}">
          <thead>
            <tr class="text-left text-xs text-text-muted">
              <th scope="col" class="py-1 pr-3 font-medium">Day</th>
              {#each fields as f (f.id)}
                <th scope="col" class="py-1 pr-3 font-medium">{f.name}{f.unit ? ` (${f.unit})` : ''}</th>
              {:else}
                <th scope="col" class="py-1 pr-3 font-medium">Done</th>
              {/each}
              <th scope="col" class="py-1 font-medium">Logged</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.day)}
              <tr class="border-t border-border">
                <th scope="row" class="py-1.5 pr-3 text-left font-normal whitespace-nowrap text-text">{dayLabel(row.day)}</th>
                {#each fields as f (f.id)}
                  <td class="py-1.5 pr-3">
                    {#if f.kind === 'boolean'}
                      <input type="checkbox" aria-label="{f.name}, {dayLabel(row.day)}" bind:checked={row.values[f.id] as boolean} class="h-4 w-4 accent-brand" />
                    {:else}
                      <input
                        type="text"
                        inputmode="decimal"
                        aria-label="{f.name}, {dayLabel(row.day)}"
                        aria-invalid={invalidCell(f, row.values[f.id])}
                        placeholder={f.kind === 'rating' ? `${f.ratingMin ?? 1}-${f.ratingMax ?? 5}` : ''}
                        bind:value={row.values[f.id] as string}
                        class="w-20 rounded-md border bg-transparent px-2 py-1 text-sm text-text placeholder:text-text-muted {invalidCell(f, row.values[f.id]) ? 'border-danger' : 'border-border'}"
                      />
                    {/if}
                  </td>
                {:else}
                  <td class="py-1.5 pr-3"><input type="checkbox" aria-label="Done, {dayLabel(row.day)}" bind:checked={row.done} class="h-4 w-4 accent-brand" /></td>
                {/each}
                <td class="py-1.5 text-xs text-text-muted">{logged.get(row.day) ? `${logged.get(row.day)} already` : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if invalid}<p class="text-xs text-danger" role="alert">Some cells aren't a number in range and won't be saved.</p>{/if}
      <div class="flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={busy || toAdd.length === 0} onclick={save}>
          Save {toAdd.length} {toAdd.length === 1 ? 'entry' : 'entries'}
        </Button>
        {#if status}<p class="text-xs text-text-muted" role="status">{status}</p>{/if}
      </div>
      <p class="text-xs text-text-muted">Each filled day becomes one entry at noon. Tab moves between cells.</p>
    </div>
  {/if}
</details>
