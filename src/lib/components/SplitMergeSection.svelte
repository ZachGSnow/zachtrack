<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push } from 'svelte-spa-router';
  import { db, mergeTrackable, splitTrackable, undoMergeTrackable, undoSplitTrackable, type FieldDefinition, type TrackableDefinition } from '../db';
  import { undoToast } from '../stores/undo.svelte';
  import { canSplit, mergedFieldIds, mergeTargets, planSplit } from '../utils/trackableSplit';
  import { describeGoal } from '../utils/trackableGoals';

  // Split by field and Merge into, at the bottom of a trackable's edit sheet
  // (3.72). Both move entries rather than copy them, archive what they empty,
  // and offer Undo for a few seconds.
  let {
    trackable,
    allFields,
    onDone,
  }: {
    trackable: TrackableDefinition;
    allFields: FieldDefinition[];
    /** Called once a split or merge is done: the sheet closes. */
    onDone: () => void;
  } = $props();

  const entries = liveQuery(() => db.trackableEntries.where('trackableId').equals(trackable.id).toArray());
  const allTrackables = liveQuery(() => db.trackableDefinitions.toArray());

  let mode = $state<'none' | 'split' | 'merge'>('none');
  let goalFieldId = $state('');
  let targetId = $state('');
  let busy = $state(false);
  let error = $state('');

  const fieldName = (id: string) => allFields.find((f) => f.id === id)?.name ?? 'Unnamed field';
  const plan = $derived(planSplit(trackable, $entries ?? []));
  const goalText = $derived(describeGoal(trackable, allFields));
  const targets = $derived(mergeTargets(trackable, $allTrackables ?? []));
  const target = $derived(targets.find((t) => t.id === targetId));
  const newFields = $derived(target ? mergedFieldIds(target.fieldIds, trackable.fieldIds).filter((id) => !target.fieldIds.includes(id)) : []);
  const entriesText = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

  function start(next: 'split' | 'merge') {
    mode = mode === next ? 'none' : next;
    error = '';
    goalFieldId = '';
    targetId = '';
  }

  async function split() {
    busy = true;
    error = '';
    const before = $state.snapshot(trackable) as TrackableDefinition;
    try {
      const result = await splitTrackable(trackable.id, goalFieldId || undefined);
      const names = result.created.map((c) => fieldName(c.fieldId)).join(' and ');
      undoToast.offer(`Split ${before.name} into ${names}`, () => undoSplitTrackable(result, before));
      onDone();
      push(result.archived ? '/trackables' : `/trackables/${trackable.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not split it. Please try again.';
    } finally {
      busy = false;
    }
  }

  async function merge() {
    if (!target) return;
    busy = true;
    error = '';
    const name = trackable.name;
    const into = target.name;
    try {
      const result = await mergeTrackable(trackable.id, target.id);
      undoToast.offer(`Merged ${name} into ${into}`, () => undoMergeTrackable(result));
      onDone();
      push(`/trackables/${result.targetId}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not merge it. Please try again.';
    } finally {
      busy = false;
    }
  }
</script>

{#if canSplit(trackable) || targets.length > 0}
  <div class="space-y-2 border-t pt-3 border-border">
    <p class="text-sm text-text-muted">Split or merge</p>
    <div class="flex flex-wrap gap-2">
      {#if canSplit(trackable)}
        <button type="button" class="rounded-lg border px-3 py-1.5 text-sm text-text border-border" aria-expanded={mode === 'split'} onclick={() => start('split')}>Split by field</button>
      {/if}
      {#if targets.length > 0}
        <button type="button" class="rounded-lg border px-3 py-1.5 text-sm text-text border-border" aria-expanded={mode === 'merge'} onclick={() => start('merge')}>Merge into...</button>
      {/if}
    </div>

    {#if mode === 'split'}
      <div class="space-y-2 rounded-lg border p-3 text-sm border-border" role="region" aria-label="Split by field">
        <p class="text-text">Makes one trackable per field and moves each entry to the field it has:</p>
        <ul class="list-disc pl-5 text-text">
          {#each plan.parts as part (part.fieldId)}
            <li>{fieldName(part.fieldId)}: {entriesText(part.entryIds.length)}</li>
          {/each}
        </ul>
        {#if plan.staying.length > 0}
          <p class="text-xs text-text-muted">{entriesText(plan.staying.length)} with more than one of the fields, or none, {plan.staying.length === 1 ? 'stays' : 'stay'} in {trackable.name}.</p>
        {:else}
          <p class="text-xs text-text-muted">{trackable.name} is then empty and is archived, not deleted.</p>
        {/if}
        {#if goalText}
          <label class="block text-xs">
            <span class="mb-1 block text-text-muted">The goal ({goalText}) goes to</span>
            <select bind:value={goalFieldId} class="w-full rounded-lg border bg-transparent p-1.5 text-sm text-text border-border">
              <option value="">{plan.staying.length > 0 ? `Stays with ${trackable.name}` : 'None of them'}</option>
              {#each plan.parts as part (part.fieldId)}
                <option value={part.fieldId}>{fieldName(part.fieldId)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <p class="text-xs text-text-muted">Entries keep their time, note and values. You can undo it for a few seconds afterwards.</p>
        <div class="flex gap-2">
          <button type="button" class="flex-1 rounded-lg border py-1.5 text-xs font-medium text-text-muted border-border" onclick={() => (mode = 'none')}>Cancel</button>
          <button type="button" class="flex-1 rounded-lg py-1.5 text-xs font-semibold bg-brand text-brand-fg disabled:opacity-50" disabled={busy || !$entries} onclick={split}>Split</button>
        </div>
      </div>
    {:else if mode === 'merge'}
      <div class="space-y-2 rounded-lg border p-3 text-sm border-border" role="region" aria-label="Merge into another trackable">
        <label class="block text-xs">
          <span class="mb-1 block text-text-muted">Move every entry of {trackable.name} into</span>
          <select bind:value={targetId} class="w-full rounded-lg border bg-transparent p-1.5 text-sm text-text border-border">
            <option value="">Pick a trackable</option>
            {#each targets as t (t.id)}
              <option value={t.id}>{t.icon} {t.name}</option>
            {/each}
          </select>
        </label>
        {#if target}
          <p class="text-xs text-text-muted">
            {entriesText($entries?.length ?? 0)} move to {target.name}{newFields.length ? `, which gains ${newFields.map(fieldName).join(', ')}` : ''}. {trackable.name} is then archived, not deleted, and its goal isn't carried over.
          </p>
        {/if}
        <div class="flex gap-2">
          <button type="button" class="flex-1 rounded-lg border py-1.5 text-xs font-medium text-text-muted border-border" onclick={() => (mode = 'none')}>Cancel</button>
          <button type="button" class="flex-1 rounded-lg py-1.5 text-xs font-semibold bg-brand text-brand-fg disabled:opacity-50" disabled={busy || !target} onclick={merge}>Merge</button>
        </div>
      </div>
    {/if}
    {#if error}
      <p class="text-xs text-danger">{error}</p>
    {/if}
  </div>
{/if}
