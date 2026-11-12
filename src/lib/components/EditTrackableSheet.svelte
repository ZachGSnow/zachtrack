<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    db,
    addTrackableEntry,
    addTrackableEntries,
    createFieldDefinition,
    createTrackable,
    updateTrackable,
    deleteTrackable,
    type TrackableDefinition,
    type TrackableGoalType,
    type DateKind,
    type FieldDefinition,
  } from '../db';
  import {
    autoKind,
    KIND_DESCRIPTIONS as SUMMARY_DESCRIPTIONS,
    KIND_LABELS as SUMMARY_LABELS,
    resolveKind,
    type TrackableKind,
  } from '../utils/trackableKinds';

  import { DAILY_GOALS, goalField, withScheduleChange } from '../utils/trackableGoals';
  import { fromDateInputValue, toDateInputValue } from '../utils/time';
  import { TEMPLATES, type TrackableTemplate } from '../data/templates';
  import { holidayEntry, US_HOLIDAYS } from '../data/holidays';
  import { DATE_KINDS, DATE_KIND_LABELS, DEFAULT_LEAD_DAYS } from '../utils/dates';
  import FieldsEditor from './FieldsEditor.svelte';
  import GoalEditor from './GoalEditor.svelte';
  import HelpLink from './HelpLink.svelte';

  const KINDS: TrackableKind[] = ['event', 'measurement', 'daily', 'checkin', 'ages'];

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

  let name = $state('');
  let icon = $state('');
  let color = $state(PRESET_COLORS[0]);
  let fieldIds = $state<string[]>([]);
  /** 'auto' = picked from the fields (stored as no displayMode); anything else overrides it. */
  let summaryMode = $state<'auto' | TrackableKind>('auto');
  let goalType = $state<TrackableGoalType | ''>('');
  let goalValueDraft = $state('');
  let pinned = $state(false);
  let insightsHidden = $state(false);
  /** Weekdays a daily goal applies, 0 = Monday; all seven = every day. */
  let scheduleDays = $state<number[]>([0, 1, 2, 3, 4, 5, 6]);
  let pausedUntilDraft = $state('');
  /** For a dates trackable (summary 'ages'): what its dates are, and how many days ahead they show in Needs attention. */
  let dateKind = $state<DateKind>('birthday');
  let leadDaysDraft = $state('');
  /** Set by the US holidays template: add the pack's entries once the trackable is created. */
  let withHolidayPack = $state(false);
  let error = $state('');

  $effect(() => {
    if (!open) return;
    name = trackable?.name ?? '';
    icon = trackable?.icon ?? '';
    color = trackable?.color ?? PRESET_COLORS[0];
    fieldIds = trackable?.fieldIds ?? [];
    summaryMode = trackable && !resolveKind(trackable, []).auto ? resolveKind(trackable, []).kind : 'auto';
    goalType = trackable?.goalType ?? '';
    goalValueDraft = trackable?.goalValue?.toString() ?? '';
    pinned = trackable?.pinned ?? false;
    insightsHidden = trackable?.insightsHidden ?? false;
    scheduleDays = trackable?.scheduleDays?.length ? [...trackable.scheduleDays] : [0, 1, 2, 3, 4, 5, 6];
    pausedUntilDraft = trackable?.pausedUntil ? toDateInputValue(trackable.pausedUntil) : '';
    dateKind = trackable?.dateKind ?? 'birthday';
    leadDaysDraft = trackable?.dateLeadDays?.toString() ?? '';
    withHolidayPack = false;
    error = '';
  });

  const attachedFields = $derived(
    fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null),
  );
  /** What Auto would pick for the fields as they are now in this sheet. */
  const auto = $derived(autoKind(attachedFields));

  /** Fills the new-trackable sheet from a template, reusing fields you already have by name and kind. */
  async function applyTemplate(template: TrackableTemplate) {
    error = '';
    try {
      const ids: string[] = [];
      for (const spec of template.fields) {
        const existing = ($allFields ?? []).find((f) => f.kind === spec.kind && f.name.trim().toLowerCase() === spec.name.toLowerCase());
        const field =
          existing ??
          (await createFieldDefinition({
            name: spec.name,
            kind: spec.kind,
            unit: spec.unit,
            ratingMin: spec.kind === 'rating' ? 1 : undefined,
            ratingMax: spec.kind === 'rating' ? (spec.ratingMax ?? 5) : undefined,
            aggregation: spec.aggregation,
          }));
        ids.push(field.id);
      }
      name = template.name;
      icon = template.icon;
      color = template.color;
      fieldIds = ids;
      goalType = template.goalType ?? '';
      goalValueDraft = template.goalValue?.toString() ?? '';
      summaryMode = template.dateKind ? 'ages' : 'auto';
      dateKind = template.dateKind ?? 'birthday';
      leadDaysDraft = '';
      withHolidayPack = !!template.holidayPack;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not use that template. Please try again.';
    }
  }

  async function handleSave() {
    error = '';
    const trimmedName = name.trim();
    if (!trimmedName) {
      error = 'Please enter a name.';
      return;
    }
    const isDates = summaryMode === 'ages';
    let dateLeadDays: number | undefined;
    if (isDates && leadDaysDraft.trim()) {
      dateLeadDays = Number(leadDaysDraft);
      if (!Number.isInteger(dateLeadDays) || dateLeadDays < 0 || dateLeadDays > 365) {
        error = 'Enter how many days ahead as a whole number from 0 to 365.';
        return;
      }
    }
    let goalValue: number | undefined;
    if (!isDates && goalType && goalType !== 'avoid') {
      goalValue = Number(goalValueDraft);
      const wholeNumber = goalType !== 'dailyTotal';
      if (!Number.isFinite(goalValue) || goalValue <= 0 || (wholeNumber && !Number.isInteger(goalValue))) {
        error = wholeNumber ? 'Enter the goal as a whole number above 0.' : 'Enter the goal as a number above 0.';
        return;
      }
      if (goalType && DAILY_GOALS.includes(goalType) && scheduleDays.length === 0) {
        error = 'Pick at least one day the goal applies.';
        return;
      }
      if (goalType === 'perWeek' && goalValue > 7) {
        error = 'A week has 7 days, so the goal can be at most 7 times a week.';
        return;
      }
      if (goalType === 'dailyTotal' && !goalField(attachedFields)) {
        error = 'A daily total needs a number field to add up. Add one, or pick another goal.';
        return;
      }
    }
    const nextSchedule = goalType && DAILY_GOALS.includes(goalType) && scheduleDays.length < 7 ? [...scheduleDays].sort((a, b) => a - b) : undefined;
    const payload = {
      name: trimmedName,
      icon: icon.trim() || '\u2b50',
      color,
      fieldIds: [...fieldIds],
      displayMode: summaryMode === 'auto' ? undefined : summaryMode,
      // A dates trackable has no goal; its dates show in Needs attention by lead time instead.
      goalType: isDates ? undefined : goalType || undefined,
      goalValue: isDates ? undefined : goalValue,
      dateKind: isDates ? dateKind : undefined,
      dateLeadDays,
      pinned: pinned || undefined,
      insightsHidden: isDates ? undefined : insightsHidden || undefined,
      scheduleDays: nextSchedule,
      // The old weekdays stay in force for the days before today (3.51).
      ...(trackable ? { scheduleHistory: withScheduleChange(trackable, nextSchedule, Date.now()) } : {}),
      pausedUntil: goalType && pausedUntilDraft ? fromDateInputValue(pausedUntilDraft) : undefined,
    };
    try {
      if (trackable) {
        await updateTrackable(trackable.id, payload);
        onSaved?.(trackable.id);
      } else {
        const created = await createTrackable(payload);
        if (isDates && withHolidayPack) {
          await addTrackableEntries(US_HOLIDAYS.map((spec) => ({ trackableId: created.id, ...holidayEntry(spec) })));
        }
        onSaved?.(created.id);
      }
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this trackable. Please try again.';
    }
  }

  /** Archive hides it from the list without deleting anything; saving the rest of the sheet is separate. */
  async function handleArchive() {
    if (!trackable) return;
    try {
      await updateTrackable(trackable.id, { archived: trackable.archived ? undefined : true });
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not archive this trackable. Please try again.';
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

  {#if !trackable}
    <div>
      <p class="mb-1.5 text-sm text-text-muted">Start from a template</p>
      <div class="flex flex-wrap gap-1.5">
        {#each TEMPLATES as template (template.name)}
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium"
            style={name === template.name
              ? `background: ${template.color}22; color: ${template.color}; border-color: ${template.color}80;`
              : 'border-color: var(--color-border); color: var(--color-text-muted);'}
            onclick={() => applyTemplate(template)}
          >{template.icon} {template.name}</button>
        {/each}
      </div>
      <p class="mt-1 text-xs text-text-muted">Or fill in your own below. Everything stays editable.</p>
    </div>
  {/if}

  <div class="grid grid-cols-[1fr_auto] gap-2">
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Name</span>
      <input
        type="text"
        bind:value={name}
        placeholder="e.g. Watered Plants"
        class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border"
      />
    </label>
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Icon</span>
      <input
        type="text"
        bind:value={icon}
        placeholder="&#x1F33F;"
        class="w-16 rounded-lg border bg-transparent p-2 text-center text-text placeholder:text-text-muted border-border"
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

  <label class="block text-sm">
    <span class="mb-1 flex items-center gap-1.5 text-text-muted">Summary <HelpLink topic="trackables" label="what each kind shows" /></span>
    <select
      bind:value={summaryMode}
      class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
    >
      <option value="auto">Auto: {SUMMARY_LABELS[auto.kind]}</option>
      {#each KINDS as k (k)}
        <option value={k}>{SUMMARY_LABELS[k]}</option>
      {/each}
    </select>
    <span class="mt-1 block text-xs text-text-muted">
      {summaryMode === 'auto'
        ? `${SUMMARY_LABELS[auto.kind]}, because ${auto.reason}. ${SUMMARY_DESCRIPTIONS[auto.kind]}`
        : SUMMARY_DESCRIPTIONS[summaryMode]}
    </span>
  </label>

  {#if summaryMode !== 'ages'}
    <GoalEditor bind:goalType bind:goalValueDraft bind:scheduleDays bind:pausedUntilDraft {attachedFields} />
  {:else}
    <div class="space-y-2">
      <label class="block text-sm">
        <span class="mb-1 flex items-center gap-1.5 text-text-muted">Dates are <HelpLink topic="dates" label="dates" /></span>
        <select bind:value={dateKind} class="w-full rounded-lg border bg-transparent p-2 text-text border-border">
          {#each DATE_KINDS as k (k)}
            <option value={k}>{DATE_KIND_LABELS[k]}</option>
          {/each}
        </select>
      </label>
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Show in Needs attention this many days ahead</span>
        <input
          type="text"
          inputmode="numeric"
          bind:value={leadDaysDraft}
          placeholder={String(DEFAULT_LEAD_DAYS[dateKind])}
          class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border"
          aria-label="Days ahead"
        />
        <span class="mt-1 block text-xs text-text-muted">Blank uses {DEFAULT_LEAD_DAYS[dateKind]} days. Upcoming dates also show under Coming up.</span>
      </label>
      {#if withHolidayPack && !trackable}
        <p class="text-xs text-text-muted">Saving adds {US_HOLIDAYS.length} US holidays; edit or delete any of them afterwards.</p>
      {/if}
    </div>
  {/if}

  <label class="flex items-center gap-2 text-sm text-text">
    <input type="checkbox" bind:checked={pinned} class="h-4 w-4" style="accent-color: var(--color-brand);" />
    Pin to the top of the list
  </label>

  {#if summaryMode !== 'ages'}
    <label class="flex items-start gap-2 text-sm text-text">
      <input type="checkbox" bind:checked={insightsHidden} class="mt-0.5 h-4 w-4" style="accent-color: var(--color-brand);" />
      <span>
        Keep out of comparisons
        <span class="block text-xs text-text-muted">No "on days with" insights for it, and it doesn't appear in other trackables' ones.</span>
      </span>
    </label>
  {/if}

  <FieldsEditor bind:fieldIds allFields={$allFields ?? []} trackableId={trackable?.id} {open} />

  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {/if}

  <div class="flex gap-2">
    {#if trackable}
      <button
        class="flex-1 rounded-xl border py-2.5 text-sm font-medium border-danger-line text-danger"
        onclick={handleDelete}
      >Delete</button>
      <button
        class="flex-1 rounded-xl border py-2.5 text-sm font-medium text-text-muted border-border"
        onclick={handleArchive}
      >{trackable.archived ? 'Unarchive' : 'Archive'}</button>
    {/if}
    <button
      class="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-brand text-brand-fg"
      onclick={handleSave}
    >Save</button>
  </div>
</div>
