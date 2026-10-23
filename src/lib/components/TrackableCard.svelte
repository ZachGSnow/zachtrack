<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db, type FieldDefinition, type TrackableDefinition } from '../db';
  import { resolveKind, summarize } from '../utils/trackableKinds';
  import { GOAL_STATE_COLORS, goalCardLine, goalStatus } from '../utils/trackableGoals';
  import { daysUntilNextBirthday, formatBirthdayCountdown } from '../utils/age';

  let {
    trackable,
    fields,
    onQuickLog,
  }: { trackable: TrackableDefinition; fields: FieldDefinition[]; onQuickLog: () => void } = $props();

  const entries = liveQuery(() => db.trackableEntries.where('trackableId').equals(trackable.id).toArray());

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
    ($entries ?? [])
      .map((e) => ({ name: e.note?.trim() || 'Someone', daysUntil: daysUntilNextBirthday(e.timestamp) }))
      .sort((a, b) => a.daysUntil - b.daysUntil)[0] ?? null,
  );

  const goal = $derived(kind === 'ages' ? null : goalStatus(trackable, $entries ?? [], attachedFields, now));

  const subtitle = $derived(
    kind === 'ages'
      ? nextUp
        ? `\u{1F382} ${nextUp.name}'s birthday ${formatBirthdayCountdown(nextUp.daysUntil)}`
        : 'No one added yet'
      : goal && trackable.goalType
        ? goalCardLine(goal, trackable.goalType, summarize(kind, $entries ?? [], attachedFields, now).card)
        : summarize(kind, $entries ?? [], attachedFields, now).card,
  );
</script>

<div class="flex items-center gap-3 rounded-2xl border p-3" style="border-color: var(--color-border); background: var(--color-surface);">
  <a href="/trackables/{trackable.id}" use:link class="flex flex-1 items-center gap-3 overflow-hidden">
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style="background: {trackable.color}22;">
      {trackable.icon}
    </span>
    <div class="overflow-hidden">
      <p class="truncate text-sm font-medium text-text">{trackable.name}</p>
      <p class="truncate text-xs text-text-muted" style={goal && GOAL_STATE_COLORS[goal.state] ? `color: ${GOAL_STATE_COLORS[goal.state]};` : ''}>
        {subtitle}
      </p>
    </div>
  </a>
  <button
    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
    style="background: {trackable.color}22; color: {trackable.color};"
    onclick={onQuickLog}
    aria-label="Log {trackable.name}"
  >+</button>
</div>
