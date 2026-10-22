<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    db,
    createFieldDefinition,
    updateFieldDefinition,
    createTrackable,
    updateTrackable,
    deleteTrackable,
    type TrackableDefinition,
    type TrackableDisplayMode,
    type FieldDefinition,
    type FieldKind,
    type FieldAggregation,
  } from '../db';

  let {
    open = $bindable(false),
    trackable = null,
    onSaved,
    onDeleted,
  }: {
    open: boolean;
    trackable: TrackableDefinition | null;
    onSaved?: (id: string) => void;
    onDeleted?: () => void;
  } = $props();

  const allFields = liveQuery(() => db.fieldDefinitions.orderBy('name').toArray());

  const PRESET_COLORS = [
    '#22ff88', '#a855f7', '#38bdf8', '#f97316', '#eab308',
    '#ec4899', '#ef4444', '#22d3ee', '#818cf8', '#10b981',
  ];

  const KIND_LABELS: Record<FieldKind, string> = { number: 'Number', rating: 'Rating', boolean: 'Yes/No' };
  const AGGREGATION_LABELS: Record<FieldAggregation, string> = {
    sum: 'Sum same-day entries',
    average: 'Average same-day entries',
    last: 'Last entry wins',
  };

  let name = $state('');
  let icon = $state('');
  let color = $state(PRESET_COLORS[0]);
  let fieldIds = $state<string[]>([]);
  let displayMode = $state<TrackableDisplayMode>('occurrences');
  let error = $state('');

  let showNewField = $state(false);
  let newFieldName = $state('');
  let newFieldKind = $state<FieldKind>('number');
  let newFieldUnit = $state('');
  let newFieldRatingMax = $state('5');
  let newFieldAggregation = $state<FieldAggregation>('last');

  $effect(() => {
    if (!open) return;
    name = trackable?.name ?? '';
    icon = trackable?.icon ?? '';
    color = trackable?.color ?? PRESET_COLORS[0];
    fieldIds = trackable?.fieldIds ?? [];
    displayMode = trackable?.displayMode ?? 'occurrences';
    error = '';
    editingFieldId = null;
    showNewField = false;
    newFieldName = '';
    newFieldKind = 'number';
    newFieldUnit = '';
    newFieldRatingMax = '5';
    newFieldAggregation = 'last';
  });

  const attachedFields = $derived(
    fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null),
  );
  const availableFields = $derived(($allFields ?? []).filter((f) => !fieldIds.includes(f.id)));

  function removeField(id: string) {
    fieldIds = fieldIds.filter((f) => f !== id);
  }

  function addExistingField(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) fieldIds = [...fieldIds, id];
    (e.target as HTMLSelectElement).value = '';
  }

  async function createAndAttachField() {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    const field = await createFieldDefinition({
      name: trimmed,
      kind: newFieldKind,
      unit: newFieldKind === 'number' && newFieldUnit.trim() ? newFieldUnit.trim() : undefined,
      ratingMin: newFieldKind === 'rating' ? 1 : undefined,
      ratingMax: newFieldKind === 'rating' ? Number(newFieldRatingMax) || 5 : undefined,
      aggregation: newFieldKind !== 'boolean' ? newFieldAggregation : undefined,
    });
    fieldIds = [...fieldIds, field.id];
    showNewField = false;
    newFieldName = '';
    newFieldUnit = '';
    newFieldRatingMax = '5';
    newFieldAggregation = 'last';
  }

  // Editing a field's name, unit or scale. Fields are shared, so this saves
  // straight away (like the combine mode) rather than with the trackable.
  const allTrackables = liveQuery(() => db.trackableDefinitions.toArray());
  let editingFieldId = $state<string | null>(null);
  let editFieldName = $state('');
  let editFieldUnit = $state('');
  let editFieldRatingMax = $state('5');
  let editFieldError = $state('');

  /** Other trackables sharing the field being edited, which a rename also changes. */
  const editingAlsoUsedBy = $derived(
    editingFieldId
      ? ($allTrackables ?? []).filter((t) => t.id !== trackable?.id && t.fieldIds.includes(editingFieldId!)).map((t) => t.name)
      : [],
  );

  function startEditField(field: FieldDefinition) {
    editingFieldId = field.id;
    editFieldName = field.name;
    editFieldUnit = field.unit ?? '';
    editFieldRatingMax = String(field.ratingMax ?? 5);
    editFieldError = '';
  }

  async function saveEditField(field: FieldDefinition) {
    const trimmed = editFieldName.trim();
    if (!trimmed) {
      editFieldError = 'Please enter a name.';
      return;
    }
    const patch: Partial<FieldDefinition> = { name: trimmed };
    if (field.kind === 'number') patch.unit = editFieldUnit.trim() || undefined;
    if (field.kind === 'rating') {
      const max = Number(editFieldRatingMax);
      if (!Number.isInteger(max) || max < 2 || max > 100) {
        editFieldError = 'The scale must go from 1 to a whole number between 2 and 100.';
        return;
      }
      patch.ratingMax = max;
    }
    try {
      await updateFieldDefinition(field.id, patch);
      editingFieldId = null;
    } catch (e) {
      editFieldError = e instanceof Error ? e.message : 'Could not save this field. Please try again.';
    }
  }

  async function handleAggregationChange(fieldId: string, e: Event) {
    const value = (e.target as HTMLSelectElement).value as FieldAggregation;
    await updateFieldDefinition(fieldId, { aggregation: value });
  }

  async function handleSave() {
    error = '';
    const trimmedName = name.trim();
    if (!trimmedName) {
      error = 'Please enter a name.';
      return;
    }
    const payload = { name: trimmedName, icon: icon.trim() || '\u2b50', color, fieldIds: [...fieldIds], displayMode };
    try {
      if (trackable) {
        await updateTrackable(trackable.id, payload);
        onSaved?.(trackable.id);
      } else {
        const created = await createTrackable(payload);
        onSaved?.(created.id);
      }
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this trackable. Please try again.';
    }
  }

  async function handleDelete() {
    if (!trackable) return;
    if (!confirm(`Delete "${trackable.name}" and all its logged entries? This cannot be undone.`)) return;
    await deleteTrackable(trackable.id);
    open = false;
    onDeleted?.();
  }
</script>

<div class="space-y-4">
  <h2 class="text-lg font-semibold text-text">{trackable ? 'Edit trackable' : 'New trackable'}</h2>

  <div class="grid grid-cols-[1fr_auto] gap-2">
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Name</span>
      <input
        type="text"
        bind:value={name}
        placeholder="e.g. Watered Plants"
        class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted"
        style="border-color: var(--color-border);"
      />
    </label>
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Icon</span>
      <input
        type="text"
        bind:value={icon}
        placeholder="&#x1F33F;"
        class="w-16 rounded-lg border bg-transparent p-2 text-center text-text placeholder:text-text-muted"
        style="border-color: var(--color-border);"
      />
    </label>
  </div>

  <div>
    <p class="mb-1.5 text-sm text-text-muted">Color</p>
    <div class="flex flex-wrap gap-2">
      {#each PRESET_COLORS as c (c)}
        <button
          type="button"
          class="h-7 w-7 rounded-full"
          style="background: {c}; {color === c ? 'box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px ' + c + ';' : ''}"
          onclick={() => (color = c)}
          aria-label="Choose color {c}"
        ></button>
      {/each}
    </div>
  </div>

  <div>
    <p class="mb-1.5 text-sm text-text-muted">Tracker type</p>
    <div class="flex gap-2">
      <button
        type="button"
        class="flex-1 rounded-lg border py-2 text-sm font-medium"
        style={displayMode === 'occurrences'
          ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
          : 'border-color: var(--color-border); color: var(--color-text-muted);'}
        onclick={() => (displayMode = 'occurrences')}
      >Occurrences</button>
      <button
        type="button"
        class="flex-1 rounded-lg border py-2 text-sm font-medium"
        style={displayMode === 'ages'
          ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
          : 'border-color: var(--color-border); color: var(--color-text-muted);'}
        onclick={() => (displayMode = 'ages')}
      >Ages (people)</button>
    </div>
    <p class="mt-1 text-xs text-text-muted">
      {displayMode === 'ages'
        ? 'Track people by birthdate -- shows live age and upcoming-birthday countdown instead of habit stats.'
        : 'Track how often something happens -- streaks, intervals, and charts.'}
    </p>
  </div>

  <div>
    <p class="mb-1.5 text-sm text-text-muted">Fields</p>
    {#if attachedFields.length > 0}
      <ul class="mb-2 flex flex-col gap-1.5">
        {#each attachedFields as field (field.id)}
          <li class="rounded-lg border p-2 text-sm" style="border-color: var(--color-border);">
            <div class="flex items-center justify-between gap-2">
              <span class="text-text">{field.name} <span class="text-text-muted">({KIND_LABELS[field.kind]}{field.unit ? `, ${field.unit}` : ''}{field.kind === 'rating' ? `, 1 to ${field.ratingMax ?? 5}` : ''})</span></span>
              <div class="flex shrink-0 items-center gap-3">
                {#if editingFieldId !== field.id}
                  <button type="button" class="text-xs font-medium" style="color: var(--color-brand);" onclick={() => startEditField(field)} aria-label="Edit {field.name}">Edit</button>
                {/if}
                <button type="button" class="text-text-muted" onclick={() => removeField(field.id)} aria-label="Remove {field.name}">&times;</button>
              </div>
            </div>
            {#if editingFieldId === field.id}
              <div class="mt-2 space-y-2 rounded-lg border p-2" style="border-color: var(--color-border);">
                <label class="block text-xs">
                  <span class="mb-1 block text-text-muted">Field name</span>
                  <input
                    type="text"
                    bind:value={editFieldName}
                    class="w-full rounded-lg border bg-transparent p-1.5 text-sm text-text"
                    style="border-color: var(--color-border);"
                  />
                </label>
                {#if field.kind === 'number'}
                  <label class="block text-xs">
                    <span class="mb-1 block text-text-muted">Unit</span>
                    <input
                      type="text"
                      bind:value={editFieldUnit}
                      placeholder="e.g. in"
                      class="w-full rounded-lg border bg-transparent p-1.5 text-sm text-text placeholder:text-text-muted"
                      style="border-color: var(--color-border);"
                    />
                    <span class="mt-1 block text-text-muted">Only the label changes. Values you already logged are not converted.</span>
                  </label>
                {:else if field.kind === 'rating'}
                  <label class="block text-xs">
                    <span class="mb-1 block text-text-muted">Scale: 1 to</span>
                    <input
                      type="text"
                      inputmode="numeric"
                      bind:value={editFieldRatingMax}
                      class="w-20 rounded-lg border bg-transparent p-1.5 text-sm text-text"
                      style="border-color: var(--color-border);"
                    />
                  </label>
                {/if}
                {#if editingAlsoUsedBy.length > 0}
                  <p class="text-xs text-text-muted">Also changes it in: {editingAlsoUsedBy.join(', ')}</p>
                {/if}
                {#if editFieldError}
                  <p class="text-xs" style="color: #f87171;">{editFieldError}</p>
                {/if}
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="flex-1 rounded-lg border py-1.5 text-xs font-medium text-text-muted"
                    style="border-color: var(--color-border);"
                    onclick={() => (editingFieldId = null)}
                  >Cancel</button>
                  <button
                    type="button"
                    class="flex-1 rounded-lg py-1.5 text-xs font-semibold"
                    style="background: var(--color-brand); color: #06140c;"
                    onclick={() => saveEditField(field)}
                  >Save field</button>
                </div>
              </div>
            {/if}
            {#if field.kind !== 'boolean'}
              <label class="mt-1.5 block text-xs">
                <span class="mb-1 block text-text-muted">Combine same-day entries by</span>
                <select
                  class="w-full rounded-lg border bg-transparent p-1.5 text-xs text-text"
                  style="border-color: var(--color-border);"
                  value={field.aggregation ?? 'last'}
                  onchange={(e) => handleAggregationChange(field.id, e)}
                >
                  {#each ['sum', 'average', 'last'] as const as a (a)}
                    <option value={a}>{AGGREGATION_LABELS[a]}</option>
                  {/each}
                </select>
              </label>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if availableFields.length > 0}
      <select
        class="mb-2 w-full rounded-lg border bg-transparent p-2 text-sm text-text-muted"
        style="border-color: var(--color-border);"
        onchange={addExistingField}
      >
        <option value="">+ Add existing field...</option>
        {#each availableFields as field (field.id)}
          <option value={field.id}>{field.name}</option>
        {/each}
      </select>
    {/if}

    {#if !showNewField}
      <button
        type="button"
        class="text-sm font-medium"
        style="color: var(--color-brand);"
        onclick={() => (showNewField = true)}
      >+ Create new field</button>
    {:else}
      <div class="space-y-2 rounded-lg border p-3" style="border-color: var(--color-border);">
        <input
          type="text"
          bind:value={newFieldName}
          placeholder="Field name (e.g. Satisfaction)"
          class="w-full rounded-lg border bg-transparent p-2 text-sm text-text placeholder:text-text-muted"
          style="border-color: var(--color-border);"
        />
        <div class="flex gap-2">
          {#each ['number', 'rating', 'boolean'] as const as k (k)}
            <button
              type="button"
              class="flex-1 rounded-lg border py-1.5 text-xs font-medium"
              style={newFieldKind === k
                ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                : 'border-color: var(--color-border); color: var(--color-text-muted);'}
              onclick={() => (newFieldKind = k)}
            >{KIND_LABELS[k]}</button>
          {/each}
        </div>
        {#if newFieldKind === 'number'}
          <input
            type="text"
            bind:value={newFieldUnit}
            placeholder="Unit (optional, e.g. lb)"
            class="w-full rounded-lg border bg-transparent p-2 text-sm text-text placeholder:text-text-muted"
            style="border-color: var(--color-border);"
          />
        {:else if newFieldKind === 'rating'}
          <label class="block text-xs">
            <span class="mb-1 block text-text-muted">Scale: 1 to</span>
            <input
              type="text"
              inputmode="numeric"
              bind:value={newFieldRatingMax}
              class="w-20 rounded-lg border bg-transparent p-1.5 text-sm text-text"
              style="border-color: var(--color-border);"
            />
          </label>
        {/if}
        {#if newFieldKind !== 'boolean'}
          <label class="block text-xs">
            <span class="mb-1 block text-text-muted">Combine same-day entries by</span>
            <select
              class="w-full rounded-lg border bg-transparent p-1.5 text-xs text-text"
              style="border-color: var(--color-border);"
              bind:value={newFieldAggregation}
            >
              {#each ['sum', 'average', 'last'] as const as a (a)}
                <option value={a}>{AGGREGATION_LABELS[a]}</option>
              {/each}
            </select>
          </label>
        {/if}
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg border py-1.5 text-xs font-medium text-text-muted"
            style="border-color: var(--color-border);"
            onclick={() => (showNewField = false)}
          >Cancel</button>
          <button
            type="button"
            class="flex-1 rounded-lg py-1.5 text-xs font-semibold"
            style="background: var(--color-brand); color: #06140c;"
            onclick={createAndAttachField}
          >Add field</button>
        </div>
      </div>
    {/if}
  </div>

  {#if error}
    <p class="text-sm" style="color: #f87171;">{error}</p>
  {/if}

  <div class="flex gap-2">
    {#if trackable}
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
