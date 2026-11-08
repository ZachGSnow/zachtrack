<script lang="ts">
  import { liveQuery } from 'dexie';
  import { push } from 'svelte-spa-router';
  import { db, updateTrackable, type FieldDefinition, type TrackableDefinition, type TrackableEntry } from '../lib/db';
  import { resolveKind } from '../lib/utils/trackableKinds';
  import { goalStatus } from '../lib/utils/trackableGoals';
  import { LIST_SORTS, moveInOrder, orderTrackables, QUIET_DAYS, quietTrackables, type ListSort } from '../lib/utils/trackableList';
  import { formatTimeSinceAdaptive } from '../lib/utils/trackableStats';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';
  import { startOfDay } from '../lib/utils/time';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import { attentionStore } from '../lib/stores/attention.svelte';
  import { link } from 'svelte-spa-router';
  import { GOAL_STATE_COLORS } from '../lib/utils/trackableGoals';
  import TrackableCard from '../lib/components/TrackableCard.svelte';
  import ComingUp from '../lib/components/ComingUp.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditTrackableSheet from '../lib/components/EditTrackableSheet.svelte';
  import QuickLogHost from '../lib/components/QuickLogHost.svelte';
  import StarterPicker from '../lib/components/StarterPicker.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import { starterStore } from '../lib/stores/starter.svelte';
  import { quickLog } from '../lib/stores/quickLog.svelte';

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

  // Quiet trackables (utils/trackableList.ts): offered for archiving, unless "Not now" snoozed the offer on this device.
  const QUIET_PREFS_KEY = 'quiet-trackables';
  let quietSnoozedUntil = $state(Number(loadPrefs<{ until: unknown }>(QUIET_PREFS_KEY, { until: 0 }).until) || 0);
  const quiet = $derived(Date.now() < quietSnoozedUntil ? [] : quietTrackables($trackables ?? [], $allEntries ?? [], Date.now()));
  function snoozeQuiet() {
    quietSnoozedUntil = Date.now() + 30 * 24 * 3600_000;
    savePrefs(QUIET_PREFS_KEY, { until: quietSnoozedUntil });
  }
  function lastLoggedText(t: TrackableDefinition): string {
    const last = (entriesByTrackable.get(t.id) ?? []).reduce((max, e) => Math.max(max, e.timestamp), 0);
    return last ? `last ${formatTimeSinceAdaptive(Date.now() - last)} ago` : 'never logged';
  }
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

  function openCreate() {
    editingTrackable = null;
    editOpen = true;
  }

  // "+" and the check buttons log through the shared quick-log store
  // (stores/quickLog.svelte.ts): a sheet for a trackable with fields, one tap
  // with undo for one without. QuickLogHost renders the sheet and the toast.

  function handleCreated(id: string) {
    push(`/trackables/${id}`);
  }
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-3 px-5 py-6">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-semibold text-text">Trackables</h1>
    <button
      class="rounded-full px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg"
      onclick={openCreate}
    >+ New</button>
  </div>

  {#if $trackables === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if $trackables.length === 0}
    {#if starterStore.pending}
      <StarterPicker />
    {:else}
      <EmptyState title="No trackables yet" text={'Tap "+ New" to create your first one, or start from a template.'} class="mt-4" />
    {/if}
  {:else}
    {#if attentionStore.items.length > 0}
      <!-- In-app reminders: goals that are overdue or due today, most urgent first. -->
      <section class="rounded-2xl border p-3" style="border-color: var(--color-danger-line); background: var(--color-danger-soft);" aria-label="Needs attention">
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">Needs attention</p>
        <ul class="flex flex-col gap-1">
          {#each attentionStore.items as item (item.key)}
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
    <ComingUp trackables={$trackables ?? []} entries={$allEntries ?? []} />
    {#if quiet.length > 0}
      <!-- Trackables that have gone quiet: offer to archive them so they stop crowding the list. -->
      <section class="rounded-2xl border border-border bg-surface-2 p-3" aria-label="Quiet trackables">
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-text-muted">Quiet trackables</p>
          <button class="text-xs text-text-muted" onclick={snoozeQuiet}>Not now</button>
        </div>
        <p class="mb-2 text-xs text-text-muted">Nothing logged in {QUIET_DAYS} days. Archiving keeps every entry; Show archived brings one back.</p>
        <ul class="flex flex-col gap-1">
          {#each quiet as t (t.id)}
            <li class="flex items-center gap-2 px-1 py-1 text-sm">
              <span class="w-6 text-center">{t.icon}</span>
              <span class="min-w-0 flex-1 truncate text-text">{t.name}</span>
              <span class="shrink-0 text-xs text-text-muted">{lastLoggedText(t)}</span>
              <button class="shrink-0 text-xs font-semibold text-brand" onclick={() => updateTrackable(t.id, { archived: true })} aria-label="Archive {t.name}">Archive</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <div class="flex items-center justify-between gap-2">
      <SegmentedControl options={LIST_SORTS} bind:value={sort} />
      {#if reordering}
        <button class="text-sm font-semibold text-brand" onclick={() => (reordering = false)}>Done</button>
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
          onQuickLog={() => quickLog.log(t)}
          onUncheck={() => quickLog.uncheck(t, entriesByTrackable.get(t.id) ?? [])}
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
            <TrackableCard trackable={t} fields={$allFields ?? []} entries={entriesByTrackable.get(t.id) ?? []} onQuickLog={() => quickLog.log(t)} />
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<QuickLogHost />

<BottomSheet bind:open={editOpen}>
  <EditTrackableSheet bind:open={editOpen} trackable={editingTrackable} onSaved={handleCreated} />
</BottomSheet>

