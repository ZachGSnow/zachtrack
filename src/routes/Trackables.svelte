<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push } from 'svelte-spa-router';
  import { addTrackableEntry, db, deleteTrackableEntry, type TrackableDefinition } from '../lib/db';
  import TrackableCard from '../lib/components/TrackableCard.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import LogTrackableEntrySheet from '../lib/components/LogTrackableEntrySheet.svelte';
  import ProfileSheet from '../lib/components/ProfileSheet.svelte';

  const trackables = liveQuery(() => db.trackableDefinitions.orderBy('name').toArray());
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());

  let editOpen = $state(false);
  let editingTrackable = $state<TrackableDefinition | null>(null);

  let logOpen = $state(false);
  let loggingTrackable = $state<TrackableDefinition | null>(null);

  let profileOpen = $state(false);

  function openCreate() {
    editingTrackable = null;
    editOpen = true;
  }

  // A trackable with no fields has nothing to fill in, so "+" logs it right
  // away (the "I just did it" of a days-since app) with a few seconds to undo.
  let undo = $state<{ entryId: string; name: string } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  let quickLogError = $state('');

  async function openQuickLog(t: TrackableDefinition) {
    if (t.fieldIds.length > 0 || t.displayMode === 'ages') {
      loggingTrackable = t;
      logOpen = true;
      return;
    }
    quickLogError = '';
    try {
      const entry = await addTrackableEntry({ trackableId: t.id, timestamp: Date.now() });
      clearTimeout(undoTimer);
      undo = { entryId: entry.id, name: t.name };
      undoTimer = setTimeout(() => (undo = null), 6000);
    } catch (e) {
      quickLogError = e instanceof Error ? e.message : 'Could not log it. Please try again.';
    }
  }

  async function undoQuickLog() {
    if (!undo) return;
    const { entryId } = undo;
    undo = null;
    clearTimeout(undoTimer);
    await deleteTrackableEntry(entryId);
  }

  function handleCreated(id: string) {
    push(`/trackables/${id}`);
  }
</script>

<div class="flex flex-1 flex-col gap-3 px-5 py-6">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-semibold text-text">Trackables</h1>
    <div class="flex items-center gap-2">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full border text-sm"
        style="border-color: var(--color-border); color: var(--color-text-muted);"
        onclick={() => (profileOpen = true)}
        aria-label="Profile"
      >&#x1F464;</button>
      <button
        class="rounded-full px-3 py-1.5 text-sm font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={openCreate}
      >+ New</button>
    </div>
  </div>

  {#if $trackables === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if $trackables.length === 0}
    <p class="mt-8 text-center text-sm text-text-muted">No trackables yet. Tap "+ New" to create your first one.</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each $trackables as t (t.id)}
        <TrackableCard trackable={t} fields={$allFields ?? []} onQuickLog={() => openQuickLog(t)} />
      {/each}
    </div>
  {/if}
</div>

{#if undo}
  <div
    class="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[calc(100%-2.5rem)] max-w-md items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg"
    style="border-color: var(--color-border); background: var(--color-surface);"
    role="status"
  >
    <span class="truncate text-text">Logged {undo.name}</span>
    <button class="shrink-0 font-semibold" style="color: var(--color-brand);" onclick={undoQuickLog}>Undo</button>
  </div>
{/if}
{#if quickLogError}
  <p class="px-5 text-sm" style="color: #f87171;">{quickLogError}</p>
{/if}

<BottomSheet bind:open={editOpen}>
  <EditTrackableSheet bind:open={editOpen} trackable={editingTrackable} onSaved={handleCreated} />
</BottomSheet>

<BottomSheet bind:open={logOpen}>
  <LogTrackableEntrySheet bind:open={logOpen} trackable={loggingTrackable} />
</BottomSheet>

<BottomSheet bind:open={profileOpen}>
  <ProfileSheet bind:open={profileOpen} />
</BottomSheet>
