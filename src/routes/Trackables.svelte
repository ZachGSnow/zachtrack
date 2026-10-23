<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push } from 'svelte-spa-router';
  import {
    addTrackableEntry,
    db,
    deleteTrackableEntry,
    updateTrackable,
    type FieldDefinition,
    type TrackableDefinition,
    type TrackableEntry,
  } from '../lib/db';
  import { resolveKind } from '../lib/utils/trackableKinds';
  import { goalStatus } from '../lib/utils/trackableGoals';
  import { LIST_SORTS, moveInOrder, orderTrackables, type ListSort } from '../lib/utils/trackableList';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { startOfDay } from '../lib/utils/time';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import { attentionStore } from '../lib/stores/attention.svelte';
  import { link } from 'svelte-spa-router';
  import { GOAL_STATE_COLORS } from '../lib/utils/trackableGoals';
  import TrackableCard from '../lib/components/TrackableCard.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import LogTrackableEntrySheet from '../lib/components/LogTrackableEntrySheet.svelte';
  import ProfileSheet from '../lib/components/ProfileSheet.svelte';

  const trackables = liveQuery(() => db.trackableDefinitions.orderBy('name').toArray());
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());
  const allEntries = liveQuery(() => db.trackableEntries.toArray());

  const PREFS_KEY = 'trackables-view';
  const saved = loadPrefs<{ sort: unknown; compact: unknown }>(PREFS_KEY, { sort: 'due', compact: false });
  let sort = $state<ListSort>(oneOf(saved.sort, LIST_SORTS.map((s) => s.id), 'due'));
  $effect(() => {
    savePrefs(PREFS_KEY, { sort, compact });
  });

  let reordering = $state(false);
  /** Compact: goal cards without their grid strips, for a shorter list. Per device. */
  let compact = $state(saved.compact === true);
  let showArchived = $state(false);

  const entriesByTrackable = $derived.by(() => {
    const map = new Map<string, TrackableEntry[]>();
    for (const e of $allEntries ?? []) {
      const list = map.get(e.trackableId);
      if (list) list.push(e);
      else map.set(e.trackableId, [e]);
    }
    return map;
  });

  function attached(t: TrackableDefinition): FieldDefinition[] {
    return t.fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
  }

  function urgency(t: TrackableDefinition): number | undefined {
    const fields = attached(t);
    if (resolveKind(t, fields).kind === 'ages') return undefined;
    return goalStatus(t, entriesByTrackable.get(t.id) ?? [], fields)?.urgency;
  }

  const active = $derived(orderTrackables(($trackables ?? []).filter((t) => !t.archived), sort, urgency));
  const archived = $derived(orderTrackables(($trackables ?? []).filter((t) => t.archived), 'name', () => undefined));

  async function move(t: TrackableDefinition, direction: -1 | 1) {
    const current = new Map(active.map((a) => [a.id, a.sortOrder]));
    for (const change of moveInOrder(active.map((a) => a.id), t.id, direction, current)) {
      await updateTrackable(change.id, { sortOrder: change.sortOrder });
    }
  }

  // The up/down buttons only mean something in "My order".
  $effect(() => {
    if (sort !== 'manual') reordering = false;
  });

  function startReordering() {
    sort = 'manual';
    reordering = true;
  }

  let editOpen = $state(false);
  let editingTrackable = $state<TrackableDefinition | null>(null);

  let logOpen = $state(false);
  let loggingTrackable = $state<TrackableDefinition | null>(null);

  let profileOpen = $state(false);

  function openCreate() {
    editingTrackable = null;
    editOpen = true;
  }

  // A trackable with no fields has nothing to fill in, so "+" (or its check
  // button) logs it right away, the "I just did it" of a days-since app, and
  // checking it again takes today's entry back off. Either way there are a few
  // seconds to undo.
  let undo = $state<{ message: string; revert: () => Promise<unknown> } | null>(null);

  function offerUndo(message: string, revert: () => Promise<unknown>) {
    clearTimeout(undoTimer);
    undo = { message, revert };
    undoTimer = setTimeout(() => (undo = null), 6000);
  }
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
      offerUndo(`Logged ${t.name}`, () => deleteTrackableEntry(entry.id));
    } catch (e) {
      quickLogError = e instanceof Error ? e.message : 'Could not log it. Please try again.';
    }
  }

  /** Unchecks today: removes today's latest entry; Undo puts it back. */
  async function uncheckToday(t: TrackableDefinition) {
    const today = startOfDay(Date.now());
    const latest = (entriesByTrackable.get(t.id) ?? [])
      .filter((e) => startOfDay(e.timestamp) === today)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!latest) return;
    quickLogError = '';
    try {
      await deleteTrackableEntry(latest.id);
      const { timestamp, note, tags, values } = latest;
      offerUndo(`Unchecked ${t.name}`, () => addTrackableEntry({ trackableId: t.id, timestamp, note, tags, values }));
    } catch (e) {
      quickLogError = e instanceof Error ? e.message : 'Could not uncheck it. Please try again.';
    }
  }

  async function undoQuickLog() {
    if (!undo) return;
    const { revert } = undo;
    undo = null;
    clearTimeout(undoTimer);
    await revert();
  }

  function handleCreated(id: string) {
    push(`/trackables/${id}`);
  }
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-3 px-5 py-6">
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
    {#if attentionStore.items.length > 0}
      <!-- In-app reminders: goals that are overdue or due today, most urgent first. -->
      <section class="rounded-2xl border p-3" style="border-color: #f8717155; background: #f8717110;" aria-label="Needs attention">
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide" style="color: #f87171;">Needs attention</p>
        <ul class="flex flex-col gap-1">
          {#each attentionStore.items as item (item.id)}
            <li>
              <a href="/trackables/{item.id}" use:link class="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
                <span class="w-6 text-center">{item.icon}</span>
                <span class="flex-1 truncate text-text">{item.name}</span>
                <span class="shrink-0 text-xs font-medium" style="color: {GOAL_STATE_COLORS[item.state]};">{item.text}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <div class="flex items-center justify-between gap-2">
      <SegmentedControl options={LIST_SORTS} bind:value={sort} />
      {#if reordering}
        <button class="text-sm font-semibold" style="color: var(--color-brand);" onclick={() => (reordering = false)}>Done</button>
      {:else}
        <div class="flex items-center gap-3">
          <button class="text-sm text-text-muted" onclick={() => (compact = !compact)} aria-pressed={compact}>{compact ? 'Grids' : 'Compact'}</button>
          <button class="text-sm text-text-muted" onclick={startReordering}>Reorder</button>
        </div>
      {/if}
    </div>
    {#if reordering}
      <p class="text-xs text-text-muted">Pinned trackables stay on top; the rest keep this order under "My order".</p>
    {/if}
    <!-- One column on a phone, a grid of cards on wider screens. -->
    <div class="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start 2xl:grid-cols-3">
      {#each active as t (t.id)}
        <TrackableCard
          trackable={t}
          fields={$allFields ?? []}
          entries={entriesByTrackable.get(t.id) ?? []}
          onQuickLog={() => openQuickLog(t)}
          onUncheck={() => uncheckToday(t)}
          onMove={reordering ? (direction) => move(t, direction) : undefined}
          {compact}
        />
      {/each}
    </div>
    {#if archived.length > 0}
      <button class="self-start text-sm text-text-muted" onclick={() => (showArchived = !showArchived)} aria-expanded={showArchived}>
        {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
      </button>
      {#if showArchived}
        <div class="flex flex-col gap-2 opacity-70 lg:grid lg:grid-cols-2 lg:items-start 2xl:grid-cols-3">
          {#each archived as t (t.id)}
            <TrackableCard trackable={t} fields={$allFields ?? []} entries={entriesByTrackable.get(t.id) ?? []} onQuickLog={() => openQuickLog(t)} />
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if undo}
  <div
    class="fixed inset-x-0 bottom-20 z-30 lg:bottom-6 mx-auto flex w-[calc(100%-2.5rem)] max-w-md items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg"
    style="border-color: var(--color-border); background: var(--color-surface);"
    role="status"
  >
    <span class="truncate text-text">{undo.message}</span>
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
