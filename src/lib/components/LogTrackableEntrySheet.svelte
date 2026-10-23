<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    db,
    addTrackableEntry,
    updateTrackableEntry,
    deleteTrackableEntry,
    type TrackableDefinition,
    type TrackableEntry,
    type FieldDefinition,
  } from '../db';
  import { toDatetimeLocal, fromDatetimeLocal, toDateInputValue, fromDateInputValue } from '../utils/time';
  import TagInput from './TagInput.svelte';

  let {
    open = $bindable(false),
    trackable,
    entry = null,
    defaultTimestamp,
  }: {
    open: boolean;
    trackable: TrackableDefinition | null;
    entry?: TrackableEntry | null;
    /** When a new entry starts out (e.g. a day picked in the habit grid); default now. */
    defaultTimestamp?: number;
  } = $props();

  const allFields = liveQuery(() => db.fieldDefinitions.toArray());

  const attachedFields = $derived(
    trackable
      ? trackable.fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null)
      : [],
  );
  const isAges = $derived(trackable?.displayMode === 'ages');

  let dateLocal = $state('');
  let note = $state('');
  let tags = $state<string[]>([]);
  let fieldInputs = $state<Record<string, string | number | boolean>>({});
  let error = $state('');

  // Guards against re-populating fieldInputs from unrelated field-definition
  // edits while the sheet is open and being typed in, while still allowing
  // the *initial* population to wait until the fieldDefinitions liveQuery
  // (allFields) has actually loaded -- it starts out `undefined` on mount.
  let initKey = '';
  let initialized = false;

  $effect(() => {
    if (!open || !trackable) return;
    const key = `${trackable.id}|${entry?.id ?? `new@${defaultTimestamp ?? ''}`}`;
    if (key !== initKey) {
      initKey = key;
      initialized = false;
    }
    if (initialized) return;
    if ($allFields === undefined) return; // wait for fields to load before snapshotting
    initialized = true;

    const fields = attachedFields;
    const ages = isAges;
    const when = entry?.timestamp ?? defaultTimestamp ?? Date.now();
    dateLocal = ages ? toDateInputValue(when) : toDatetimeLocal(when);
    note = entry?.note ?? '';
    tags = entry?.tags ?? [];
    const inputs: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const raw = entry?.values?.[f.id];
      if (f.kind === 'number') inputs[f.id] = raw != null ? String(raw) : '';
      else if (f.kind === 'rating') inputs[f.id] = typeof raw === 'number' ? raw : 0;
      else inputs[f.id] = typeof raw === 'boolean' ? raw : false;
    }
    fieldInputs = inputs;
    error = '';
  });

  function setRating(fieldId: string, value: number) {
    fieldInputs = { ...fieldInputs, [fieldId]: fieldInputs[fieldId] === value ? 0 : value };
  }

  function toggleBoolean(fieldId: string) {
    fieldInputs = { ...fieldInputs, [fieldId]: !fieldInputs[fieldId] };
  }

  async function handleSave() {
    if (!trackable) return;
    error = '';
    const timestamp = isAges ? fromDateInputValue(dateLocal) : fromDatetimeLocal(dateLocal);
    if (Number.isNaN(timestamp)) {
      error = 'Please enter a valid date.';
      return;
    }
    if (isAges && !note.trim()) {
      error = 'Please enter a name.';
      return;
    }

    const values: Record<string, number | boolean> = {};
    for (const f of attachedFields) {
      const raw = fieldInputs[f.id];
      if (f.kind === 'number') {
        const text = String(raw ?? '').trim();
        if (!text) continue;
        const n = Number(text);
        if (Number.isNaN(n)) {
          error = `Please enter a valid number for ${f.name}.`;
          return;
        }
        values[f.id] = n;
      } else if (f.kind === 'rating') {
        if (typeof raw === 'number' && raw > 0) values[f.id] = raw;
      } else if (f.kind === 'boolean') {
        if (raw === true) values[f.id] = true;
      }
    }

    const payload = {
      trackableId: trackable.id,
      timestamp,
      note: note.trim() || undefined,
      tags: tags.length ? [...tags] : undefined,
      values: Object.keys(values).length ? values : undefined,
    };

    try {
      if (entry) {
        await updateTrackableEntry(entry.id, payload);
      } else {
        await addTrackableEntry(payload);
      }
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this entry. Please try again.';
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await deleteTrackableEntry(entry.id);
    open = false;
  }
</script>

{#if trackable}
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-text">
      <span>{trackable.icon}</span> {trackable.name}
    </h2>

    {#if isAges}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Name</span>
        <input
          type="text"
          bind:value={note}
          placeholder="e.g. Mom"
          class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted"
          style="border-color: var(--color-border);"
        />
      </label>

      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Birthdate</span>
        <input
          type="date"
          bind:value={dateLocal}
          class="w-full rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        />
      </label>
    {:else}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Date & time</span>
        <input
          type="datetime-local"
          bind:value={dateLocal}
          class="w-full rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        />
      </label>
    {/if}

    {#each attachedFields as field (field.id)}
      {#if field.kind === 'number'}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">{field.name}{field.unit ? ` (${field.unit})` : ''}</span>
          <input
            type="text"
            inputmode="decimal"
            value={fieldInputs[field.id] ?? ''}
            oninput={(e) => (fieldInputs = { ...fieldInputs, [field.id]: (e.target as HTMLInputElement).value })}
            class="w-full rounded-lg border bg-transparent p-2 text-text"
            style="border-color: var(--color-border);"
          />
        </label>
      {:else if field.kind === 'rating'}
        <div>
          <p class="mb-1.5 text-sm text-text-muted">{field.name}</p>
          <div class="flex flex-wrap gap-2">
            {#each Array.from({ length: (field.ratingMax ?? 5) - (field.ratingMin ?? 1) + 1 }, (_, i) => (field.ratingMin ?? 1) + i) as n (n)}
              <button
                type="button"
                class="flex-1 rounded-lg border py-2 text-sm"
                style={fieldInputs[field.id] === n
                  ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                  : 'border-color: var(--color-border); color: var(--color-text-muted);'}
                onclick={() => setRating(field.id, n)}
              >{n}</button>
            {/each}
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg border p-2 text-sm"
          style="border-color: var(--color-border);"
          onclick={() => toggleBoolean(field.id)}
        >
          <span class="text-text-muted">{field.name}</span>
          <span
            class="rounded-full px-3 py-1 text-xs font-semibold"
            style={fieldInputs[field.id]
              ? 'background: var(--color-brand); color: #06140c;'
              : 'background: var(--color-surface-2); color: var(--color-text-muted);'}
          >{fieldInputs[field.id] ? 'Yes' : 'No'}</span>
        </button>
      {/if}
    {/each}

    {#if !isAges}
      <div>
        <p class="mb-1.5 text-sm text-text-muted">Tags</p>
        <TagInput bind:tags />
      </div>

      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Note</span>
        <textarea
          bind:value={note}
          rows="2"
          class="w-full resize-none rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        ></textarea>
      </label>
    {/if}

    {#if error}
      <p class="text-sm" style="color: #f87171;">{error}</p>
    {/if}

    <div class="flex gap-2">
      {#if entry}
        <button
          class="flex-1 rounded-xl border py-2.5 text-sm font-medium"
          style="border-color: #ef444460; color: #f87171;"
          onclick={handleDelete}
        >Delete</button>
      {/if}
      <button
        class="flex-1 rounded-xl py-2.5 text-sm font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={handleSave}
      >Save</button>
    </div>
  </div>
{/if}
