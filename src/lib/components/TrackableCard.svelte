<script lang="ts">
  import { clock } from '../stores/clock.svelte';
  import { link } from 'svelte-spa-router';
  import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
  import { resolveKind, summarize } from '../utils/trackableKinds';
  import { GOAL_STATE_COLORS, goalCardLine, habitStrength } from '../utils/trackableGoals';
  import { checkState } from '../utils/quickCheck';
  import { describeDate } from '../utils/dates';
  import { habitGridWeeks } from '../utils/habitGrid';
  import HabitGrid from './HabitGrid.svelte';
  import CheckButton from './CheckButton.svelte';
  import { themeStore } from '../stores/theme.svelte';
  import { measurementView } from '../stores/measurementView.svelte';
  import { readableGraphic } from '../utils/color';

  let {
    trackable,
    fields,
    entries,
    onQuickLog,
    onUncheck,
    onMove,
    compact = false,
  }: {
    trackable: TrackableDefinition;
    fields: FieldDefinition[];
    entries: TrackableEntry[];
    onQuickLog: () => void;
    /** Takes today's entry back off (the check button of a goal card without fields). */
    onUncheck?: () => void;
    /** Set while reordering the list: shows up/down buttons instead of "+". */
    onMove?: (direction: -1 | 1) => void;
    /** Hides a goal card's grid strip (the list's compact view). */
    compact?: boolean;
  } = $props();

  const attachedFields = $derived(
    trackable.fieldIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null),
  );
  const kind = $derived(resolveKind(trackable, attachedFields).kind);
  // The trackable's colour as drawn on the card: tinted backgrounds use it as
  // is; text, rings and the "+" get a version that reads on this theme.
  const ink = $derived(readableGraphic(trackable.color, themeStore.effective));

  // Re-render "2h ago" as time passes, from the one shared clock (3.68).
  const now = $derived(clock.now);

  // A dates trackable's card lists its next few dates: "Mom in 12 days, Wedding tomorrow".
  const nextUp = $derived(
    kind === 'ages'
      ? entries
          .map((e) => describeDate(trackable, e, now))
          .filter((d) => d.daysUntil >= 0)
          .sort((a, b) => a.daysUntil - b.daysUntil)
          .slice(0, 3)
      : [],
  );

  // A trackable with a goal (other than avoid, where logging means you slipped)
  // gets the habit-tracker card: a check button for today and a strip of its grid.
  const check = $derived(checkState(trackable, kind, entries, attachedFields, now));
  const goal = $derived(check.goal);

  // As many whole weeks as fit the card at about 14px a cell.
  let stripWidth = $state(0);
  const stripWeeks = $derived(Math.max(8, Math.min(53, Math.floor((stripWidth + 3) / 17))));
  const strip = $derived(check.goalCard ? habitGridWeeks(trackable, entries, attachedFields, stripWeeks, now) : []);

  // Without fields a tap logs one more until today is done; then it takes the last one back off.
  function tapCheck() {
    if (check.noFields && check.doneToday && onUncheck) onUncheck();
    else onQuickLog();
  }

  const subtitle = $derived(
    kind === 'ages'
      ? nextUp.length
        ? nextUp.map((d) => `${d.name} ${d.daysUntil <= 1 ? d.countdown.toLowerCase() : d.countdown}`).join(', ')
        : entries.length
          ? 'Nothing coming up'
          : 'Nothing added yet'
      : goal && trackable.goalType
        ? goalCardLine(goal, trackable.goalType, summarize(kind, entries, attachedFields, now, measurementView.view).card, entries.length ? habitStrength(trackable, entries, attachedFields, now) : null)
        : summarize(kind, entries, attachedFields, now, measurementView.view).card,
  );
</script>

<div class="rounded-2xl border border-border bg-surface p-3">
  <div class="flex items-center gap-3">
    <a href="/trackables/{trackable.id}" use:link class="flex flex-1 items-center gap-3 overflow-hidden">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style="background: {trackable.color}22;">
        {trackable.icon}
      </span>
      <div class="overflow-hidden">
        <p class="truncate text-sm font-medium text-text">
          {#if trackable.pinned}<span class="mr-1 text-xs" aria-label="Pinned">&#x1F4CC;</span>{/if}{trackable.name}
        </p>
        <p class="truncate text-xs text-text-muted" style={goal && GOAL_STATE_COLORS[goal.state] ? `color: ${GOAL_STATE_COLORS[goal.state]};` : ''}>
          {subtitle}
        </p>
      </div>
    </a>
    {#if onMove}
      <div class="flex shrink-0 gap-1">
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full border border-border text-sm text-text-muted"
          onclick={() => onMove(-1)}
          aria-label="Move {trackable.name} up"
        >&uarr;</button>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full border border-border text-sm text-text-muted"
          onclick={() => onMove(1)}
          aria-label="Move {trackable.name} down"
        >&darr;</button>
      </div>
    {:else if check.goalCard}
      <CheckButton state={check} color={ink} onclick={tapCheck} />
    {:else}
      <button
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
        style="background: {trackable.color}22; color: {ink};"
        onclick={onQuickLog}
        aria-label="Log {trackable.name}"
      >+</button>
    {/if}
  </div>
  {#if check.goalCard && !compact}
    <div class="mt-2.5" bind:clientWidth={stripWidth}>
      <HabitGrid weeks={strip} color={ink} labels={false} maxCell={16} />
    </div>
  {/if}
</div>
