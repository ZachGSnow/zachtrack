<script lang="ts">
  import type { FieldDefinition, TrackableGoalType } from '../db';
  import { DAILY_GOALS, GOAL_LABELS, GOAL_TYPES, goalField, WEEKDAY_NAMES } from '../utils/trackableGoals';
  import HelpLink from './HelpLink.svelte';

  // A trackable's goal in the edit sheet (EditTrackableSheet.svelte, 3.18,
  // 3.25): the kind, the amount, the days it applies and a pause. The sheet
  // owns the drafts and checks them on Save.
  let {
    goalType = $bindable(),
    goalValueDraft = $bindable(),
    scheduleDays = $bindable(),
    pausedUntilDraft = $bindable(),
    attachedFields,
  }: {
    goalType: TrackableGoalType | '';
    goalValueDraft: string;
    /** Weekdays a daily goal applies, 0 = Monday; all seven = every day. */
    scheduleDays: number[];
    pausedUntilDraft: string;
    attachedFields: FieldDefinition[];
  } = $props();

  const GOAL_HINTS: Record<TrackableGoalType, string> = {
    dailyTotal: 'Adds up the first number field each day, like Calories or Water.',
    perDay: 'Counts each entry today; without fields, each tap of the check button is one.',
    perWeek: 'Counts the days you log it, Monday to Sunday.',
    everyDays: 'Due again that many days after the last entry; shows when it is due or overdue.',
    avoid: 'For things you want to do less: the time since it last happened is the streak.',
  };

  const goalValueLabel = $derived.by(() => {
    if (goalType === 'perWeek') return 'Times per week';
    if (goalType === 'perDay') return 'Times per day';
    if (goalType === 'everyDays') return 'Every how many days';
    const f = goalField(attachedFields);
    return f ? `${f.name} per day${f.unit ? ` (${f.unit})` : ''}` : 'Amount per day';
  });
</script>

<div class="space-y-2">
  <label class="block text-sm">
    <span class="mb-1 flex items-center gap-1.5 text-text-muted">Goal <HelpLink topic="goals" label="goals" /></span>
    <select
      bind:value={goalType}
      class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
    >
      <option value="">No goal</option>
      {#each GOAL_TYPES as g (g)}
        <option value={g}>{GOAL_LABELS[g]}</option>
      {/each}
    </select>
  </label>
  {#if goalType && goalType !== 'avoid'}
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">{goalValueLabel}</span>
      <input
        type="text"
        inputmode="decimal"
        bind:value={goalValueDraft}
        class="w-32 rounded-lg border bg-transparent p-2 text-text border-border"
      />
    </label>
  {/if}
  {#if goalType}
    <p class="text-xs text-text-muted">{GOAL_HINTS[goalType]}</p>
  {/if}
  {#if goalType && DAILY_GOALS.includes(goalType)}
    <div>
      <p class="mb-1 text-sm text-text-muted">On these days</p>
      <div class="flex gap-1" role="group" aria-label="Goal days">
        {#each WEEKDAY_NAMES as name, i (name)}
          <button
            type="button"
            class="flex-1 rounded-lg border py-1.5 text-xs font-medium"
            style={scheduleDays.includes(i)
              ? 'background: var(--color-brand); color: var(--color-brand-fg); border-color: var(--color-brand);'
              : 'border-color: var(--color-border); color: var(--color-text-muted);'}
            aria-pressed={scheduleDays.includes(i)}
            onclick={() => (scheduleDays = scheduleDays.includes(i) ? scheduleDays.filter((d) => d !== i) : [...scheduleDays, i])}
          >{name}</button>
        {/each}
      </div>
      <p class="mt-1 text-xs text-text-muted">Other days are rest days: they don't break the streak.</p>
    </div>
  {/if}
  {#if goalType && goalType !== 'avoid'}
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Paused until (optional)</span>
      <div class="flex gap-2">
        <input
          type="date"
          bind:value={pausedUntilDraft}
          class="flex-1 rounded-lg border bg-transparent p-2 text-text border-border"
        />
        {#if pausedUntilDraft}
          <button type="button" class="rounded-lg border px-3 text-sm text-text-muted border-border" onclick={() => (pausedUntilDraft = '')}>Clear</button>
        {/if}
      </div>
      <span class="mt-1 block text-xs text-text-muted">For a holiday or a sick week: nothing is due, and the streak waits.</span>
    </label>
  {/if}
</div>
