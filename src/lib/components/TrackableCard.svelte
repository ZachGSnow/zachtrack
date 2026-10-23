<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
  import { resolveKind, summarize } from '../utils/trackableKinds';
  import { GOAL_STATE_COLORS, goalCardLine, goalStatus } from '../utils/trackableGoals';
  import { daysUntilNextBirthday, formatBirthdayCountdown } from '../utils/age';
  import { habitGridWeeks } from '../utils/habitGrid';
  import { startOfDay } from '../utils/time';
  import HabitGrid from './HabitGrid.svelte';

  let {
    trackable,
    fields,
    entries,
    onQuickLog,
    onUncheck,
    onMove,
  }: {
    trackable: TrackableDefinition;
    fields: FieldDefinition[];
    entries: TrackableEntry[];
    onQuickLog: () => void;
    /** Takes today's entry back off (the check button of a goal card without fields). */
    onUncheck?: () => void;
    /** Set while reordering the list: shows up/down buttons instead of "+". */
    onMove?: (direction: -1 | 1) => void;
  } = $props();

  const attachedFields = $derived(
    trackable.fieldIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null),
  );
  const kind = $derived(resolveKind(trackable, attachedFields).kind);

  // Re-render "2h ago" as time passes, not only when entries change.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const nextUp = $derived(
    (entries)
      .map((e) => ({ name: e.note?.trim() || 'Someone', daysUntil: daysUntilNextBirthday(e.timestamp) }))
      .sort((a, b) => a.daysUntil - b.daysUntil)[0] ?? null,
  );

  const goal = $derived(kind === 'ages' ? null : goalStatus(trackable, entries, attachedFields, now));

  // A trackable with a goal (other than avoid, where logging means you slipped)
  // gets the habit-tracker card: a check button for today and a strip of its grid.
  const goalCard = $derived(!!trackable.goalType && trackable.goalType !== 'avoid' && kind !== 'ages');
  const noFields = $derived(trackable.fieldIds.length === 0);
  const loggedToday = $derived(entries.some((e) => startOfDay(e.timestamp) === startOfDay(now)));
  const counted = $derived(trackable.goalType === 'dailyTotal' || trackable.goalType === 'perDay');
  const todayCount = $derived(entries.filter((e) => startOfDay(e.timestamp) === startOfDay(now)).length);
  const doneToday = $derived(counted ? goal?.state === 'done' : loggedToday);
  // Daily totals and times-per-day show a ring filling toward today's goal until it's met.
  const ring = $derived(counted && !doneToday ? (goal?.progress ?? 0) : null);

  // As many whole weeks as fit the card at about 14px a cell.
  let stripWidth = $state(0);
  const stripWeeks = $derived(Math.max(8, Math.min(53, Math.floor((stripWidth + 3) / 17))));
  const strip = $derived(goalCard ? habitGridWeeks(trackable, entries, attachedFields, stripWeeks, now) : []);

  // Without fields a tap logs one more until today is done; then it takes the last one back off.
  function check() {
    if (noFields && doneToday && onUncheck) onUncheck();
    else onQuickLog();
  }

  const checkLabel = $derived(
    !noFields
      ? `Log ${trackable.name}`
      : doneToday
        ? `Uncheck ${trackable.name} for today`
        : trackable.goalType === 'perDay'
          ? `Log one ${trackable.name} (${todayCount} of ${trackable.goalValue} today)`
          : `Check ${trackable.name} for today`,
  );

  const subtitle = $derived(
    kind === 'ages'
      ? nextUp
        ? `\u{1F382} ${nextUp.name}'s birthday ${formatBirthdayCountdown(nextUp.daysUntil)}`
        : 'No one added yet'
      : goal && trackable.goalType
        ? goalCardLine(goal, trackable.goalType, summarize(kind, entries, attachedFields, now).card)
        : summarize(kind, entries, attachedFields, now).card,
  );
</script>

<div class="rounded-2xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
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
          class="flex h-9 w-9 items-center justify-center rounded-full border text-sm text-text-muted"
          style="border-color: var(--color-border);"
          onclick={() => onMove(-1)}
          aria-label="Move {trackable.name} up"
        >&uarr;</button>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full border text-sm text-text-muted"
          style="border-color: var(--color-border);"
          onclick={() => onMove(1)}
          aria-label="Move {trackable.name} down"
        >&darr;</button>
      </div>
    {:else if goalCard}
      <button
        class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold"
        style={doneToday
          ? `background: ${trackable.color}; color: #06140c;`
          : `box-shadow: inset 0 0 0 2px ${ring != null ? `${trackable.color}33` : `${trackable.color}99`}; color: ${trackable.color};`}
        onclick={check}
        aria-label={checkLabel}
        aria-pressed={noFields ? doneToday : undefined}
      >
        {#if ring != null}
          <!-- Progress toward today's total. -->
          <svg class="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="19" fill="none" stroke={trackable.color} stroke-width="2" stroke-linecap="round" pathLength="100" stroke-dasharray="{ring * 100} 100" />
          </svg>
          <span class="text-sm">{trackable.goalType === 'perDay' && noFields ? todayCount : '+'}</span>
        {:else if doneToday}
          &#10003;
        {:else if !noFields}
          <span class="text-base">+</span>
        {/if}
      </button>
    {:else}
      <button
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
        style="background: {trackable.color}22; color: {trackable.color};"
        onclick={onQuickLog}
        aria-label="Log {trackable.name}"
      >+</button>
    {/if}
  </div>
  {#if goalCard}
    <div class="mt-2.5" bind:clientWidth={stripWidth}>
      <HabitGrid weeks={strip} color={trackable.color} labels={false} maxCell={16} />
    </div>
  {/if}
</div>
