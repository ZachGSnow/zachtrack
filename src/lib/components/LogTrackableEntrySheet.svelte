<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    db,
    addTrackableEntry,
    updateTrackableEntry,
    deleteTrackableEntry,
    type TrackableDefinition,
    type TrackableEntry,
    type FieldDefinition,
    type DateRepeat,
  } from '../db';
  import { toDatetimeLocal, fromDatetimeLocal, toDateInputValue, fromDateInputValue } from '../utils/time';
  import { DATE_KIND_ITEM, dateKindOf, defaultRepeat, describeRepeat, ordinal } from '../utils/dates';
  import { WEEKDAY_NAMES } from '../utils/trackableGoals';
  import TagInput from './TagInput.svelte';

  let {
    open = $bindable(false),
    trackable,
    entry = null,
    defaultTimestamp,
  }: {
    open: boolean;
    trackable: TrackableDefinition | null;
    entry?: TrackableEntry | null;
    /** When a new entry starts out (e.g. a day picked in the habit grid); default now. */
    defaultTimestamp?: number;
  } = $props();

  const allFields = liveQuery(() => db.fieldDefinitions.toArray());

  const attachedFields = $derived(
    trackable
      ? trackable.fieldIds.map((id) => ($allFields ?? []).find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null)
      : [],
  );
  const isAges = $derived(trackable?.displayMode === 'ages');
  const dateKind = $derived(trackable ? dateKindOf(trackable) : 'birthday');
  const item = $derived(DATE_KIND_ITEM[dateKind]);

  // How a date repeats (DateRepeat): holidays can follow a rule, countdowns can repeat as renewals.
  type RepeatChoice = 'yearly' | 'once' | 'everyMonths' | 'everyYears' | 'nthWeekday' | 'easter';
  let repeatChoice = $state<RepeatChoice>('yearly');
  let repeatCount = $state('1');
  let ruleNth = $state(1);
  let ruleWeekday = $state(0);
  let ruleMonth = $state(0);
  let easterOffset = $state('0');
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const usesDate = $derived(repeatChoice !== 'nthWeekday' && repeatChoice !== 'easter');

  function loadRepeat(r: DateRepeat) {
    repeatChoice = r.type === 'every' ? (r.unit === 'years' ? 'everyYears' : 'everyMonths') : r.type;
    repeatCount = r.type === 'every' ? String(r.count) : '1';
    ruleNth = r.type === 'nthWeekday' ? r.nth : 1;
    ruleWeekday = r.type === 'nthWeekday' ? r.weekday : 0;
    ruleMonth = r.type === 'nthWeekday' ? r.month : 0;
    easterOffset = r.type === 'easter' ? String(r.offsetDays ?? 0) : '0';
  }

  /** The rule as chosen, or an error message. */
  function chosenRepeat(): DateRepeat | string {
    switch (repeatChoice) {
      case 'everyMonths':
      case 'everyYears': {
        const count = Number(repeatCount);
        if (!Number.isInteger(count) || count < 1 || count > 100) return 'Enter how often as a whole number from 1 to 100.';
        return { type: 'every', count, unit: repeatChoice === 'everyYears' ? 'years' : 'months' };
      }
      case 'nthWeekday':
        return { type: 'nthWeekday', month: ruleMonth, weekday: ruleWeekday, nth: ruleNth };
      case 'easter': {
        const offset = Number(easterOffset || '0');
        if (!Number.isInteger(offset) || offset < -100 || offset > 100) return 'Enter the days from Easter as a whole number from -100 to 100.';
        return offset ? { type: 'easter', offsetDays: offset } : { type: 'easter' };
      }
      default:
        return { type: repeatChoice };
    }
  }

  let dateLocal = $state('');
  let note = $state('');
  let tags = $state<string[]>([]);
  let fieldInputs = $state<Record<string, string | number | boolean>>({});
  let error = $state('');

  // The sheet fills itself once per entry (or new entry) it opens for. The
  // date, name, note and tags straight away, so nothing typed right after it
  // opens is overwritten; the field inputs once the fieldDefinitions liveQuery
  // (allFields) has loaded, since it starts out `undefined`. Neither refills
  // on unrelated edits while the sheet is open and being typed in.
  let initKey = '';
  let fieldsKey = '';

  $effect(() => {
    if (!open || !trackable) return;
    const key = `${trackable.id}|${entry?.id ?? `new@${defaultTimestamp ?? ''}`}`;
    if (key === initKey) return;
    initKey = key;
    const ages = isAges;
    const when = entry?.timestamp ?? defaultTimestamp ?? Date.now();
    dateLocal = ages ? toDateInputValue(when) : toDatetimeLocal(when);
    if (ages) loadRepeat(entry?.dateRepeat ?? defaultRepeat(dateKindOf(trackable)));
    note = entry?.note ?? '';
    tags = entry?.tags ?? [];
    error = '';
  });

  $effect(() => {
    if (!open || !trackable || $allFields === undefined) return;
    const key = `${trackable.id}|${entry?.id ?? `new@${defaultTimestamp ?? ''}`}`;
    if (key === fieldsKey) return;
    fieldsKey = key;
    const fields = attachedFields;
    const inputs: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const raw = entry?.values?.[f.id];
      if (f.kind === 'number') inputs[f.id] = raw != null ? String(raw) : '';
      else if (f.kind === 'rating') inputs[f.id] = typeof raw === 'number' ? raw : 0;
      else inputs[f.id] = typeof raw === 'boolean' ? raw : false;
    }
    fieldInputs = inputs;
  });

  function setRating(fieldId: string, value: number) {
    fieldInputs = { ...fieldInputs, [fieldId]: fieldInputs[fieldId] === value ? 0 : value };
  }

  function toggleBoolean(fieldId: string) {
    fieldInputs = { ...fieldInputs, [fieldId]: !fieldInputs[fieldId] };
  }

  async function handleSave() {
    if (!trackable) return;
    error = '';
    let dateRepeat: DateRepeat | undefined;
    if (isAges) {
      const r = chosenRepeat();
      if (typeof r === 'string') {
        error = r;
        return;
      }
      // The kind's default is left unset, so it follows the kind.
      dateRepeat = JSON.stringify(r) === JSON.stringify(defaultRepeat(dateKind)) ? undefined : r;
    }
    // A rule-based holiday has no date of its own; it keeps (or gets) a placeholder.
    const timestamp = isAges && !usesDate ? (entry?.timestamp ?? new Date(2000, 0, 1).getTime()) : isAges ? fromDateInputValue(dateLocal) : fromDatetimeLocal(dateLocal);
    if (Number.isNaN(timestamp)) {
      error = 'Please enter a valid date.';
      return;
    }
    if (isAges && !note.trim()) {
      error = `Please enter ${item.name === 'Name' ? 'a name' : 'what it is'}.`;
      return;
    }

    const values: Record<string, number | boolean> = {};
    for (const f of attachedFields) {
      const raw = fieldInputs[f.id];
      if (f.kind === 'number') {
        const text = String(raw ?? '').trim();
        if (!text) continue;
        const n = Number(text);
        if (Number.isNaN(n)) {
          error = `Please enter a valid number for ${f.name}.`;
          return;
        }
        values[f.id] = n;
      } else if (f.kind === 'rating') {
        if (typeof raw === 'number' && raw > 0) values[f.id] = raw;
      } else if (f.kind === 'boolean') {
        if (raw === true) values[f.id] = true;
      }
    }

    const payload = {
      trackableId: trackable.id,
      timestamp,
      note: note.trim() || undefined,
      tags: tags.length ? [...tags] : undefined,
      values: Object.keys(values).length ? values : undefined,
      ...(isAges ? { dateRepeat } : {}),
    };

    try {
      if (entry) {
        await updateTrackableEntry(entry.id, payload);
      } else {
        await addTrackableEntry(payload);
      }
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this entry. Please try again.';
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await deleteTrackableEntry(entry.id);
    open = false;
  }
</script>

{#if trackable}
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-text">
      <span>{trackable.icon}</span> {trackable.name}
    </h2>

    {#if isAges}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">{item.name}</span>
        <input
          type="text"
          bind:value={note}
          placeholder={item.namePlaceholder}
          class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted"
          style="border-color: var(--color-border);"
        />
      </label>

      {#if dateKind === 'holiday' || dateKind === 'countdown'}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">Repeats</span>
          <select bind:value={repeatChoice} class="w-full rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);">
            {#if dateKind === 'holiday'}
              <option value="yearly">Same date every year</option>
              <option value="nthWeekday">A weekday of a month (e.g. 4th Thursday)</option>
              <option value="easter">Easter, or days from it</option>
              <option value="once">Just once</option>
            {:else}
              <option value="once">Just once</option>
              <option value="yearly">Every year</option>
              <option value="everyMonths">Every few months</option>
              <option value="everyYears">Every few years</option>
            {/if}
          </select>
        </label>
        {#if repeatChoice === 'everyMonths' || repeatChoice === 'everyYears'}
          <label class="block text-sm">
            <span class="mb-1 block text-text-muted">Every how many {repeatChoice === 'everyYears' ? 'years' : 'months'}</span>
            <input type="text" inputmode="numeric" bind:value={repeatCount} class="w-full rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);" />
          </label>
        {:else if repeatChoice === 'nthWeekday'}
          <div class="grid grid-cols-3 gap-2 text-sm">
            <select bind:value={ruleNth} aria-label="Which" class="rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);">
              {#each [1, 2, 3, 4, 5] as n (n)}<option value={n}>{ordinal(n)}</option>{/each}
              <option value={-1}>Last</option>
            </select>
            <select bind:value={ruleWeekday} aria-label="Weekday" class="rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);">
              {#each WEEKDAY_NAMES as w, i (w)}<option value={i}>{w}</option>{/each}
            </select>
            <select bind:value={ruleMonth} aria-label="Month" class="rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);">
              {#each MONTH_NAMES as m, i (m)}<option value={i}>{m}</option>{/each}
            </select>
          </div>
        {:else if repeatChoice === 'easter'}
          <label class="block text-sm">
            <span class="mb-1 block text-text-muted">Days from Easter (0 = Easter Sunday, -2 = Good Friday)</span>
            <input type="text" inputmode="numeric" bind:value={easterOffset} class="w-full rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);" />
          </label>
        {/if}
        {#if !usesDate}
          {@const r = chosenRepeat()}
          <p class="text-xs text-text-muted">{typeof r === 'string' ? r : describeRepeat(r)}</p>
        {/if}
      {/if}

      {#if usesDate}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">{repeatChoice === 'everyMonths' || repeatChoice === 'everyYears' ? 'Next due, or last done' : item.date}</span>
          <input
            type="date"
            bind:value={dateLocal}
            class="w-full rounded-lg border bg-transparent p-2 text-text"
            style="border-color: var(--color-border);"
          />
        </label>
      {/if}
    {:else}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Date & time</span>
        <input
          type="datetime-local"
          bind:value={dateLocal}
          class="w-full rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        />
      </label>
    {/if}

    {#each attachedFields as field (field.id)}
      {#if field.kind === 'number'}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">{field.name}{field.unit ? ` (${field.unit})` : ''}</span>
          <input
            type="text"
            inputmode="decimal"
            value={fieldInputs[field.id] ?? ''}
            oninput={(e) => (fieldInputs = { ...fieldInputs, [field.id]: (e.target as HTMLInputElement).value })}
            class="w-full rounded-lg border bg-transparent p-2 text-text"
            style="border-color: var(--color-border);"
          />
        </label>
      {:else if field.kind === 'rating'}
        <div>
          <p class="mb-1.5 text-sm text-text-muted">{field.name}</p>
          <div class="flex flex-wrap gap-2">
            {#each Array.from({ length: (field.ratingMax ?? 5) - (field.ratingMin ?? 1) + 1 }, (_, i) => (field.ratingMin ?? 1) + i) as n (n)}
              <button
                type="button"
                class="flex-1 rounded-lg border py-2 text-sm"
                style={fieldInputs[field.id] === n
                  ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                  : 'border-color: var(--color-border); color: var(--color-text-muted);'}
                onclick={() => setRating(field.id, n)}
              >{n}</button>
            {/each}
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg border p-2 text-sm"
          style="border-color: var(--color-border);"
          onclick={() => toggleBoolean(field.id)}
        >
          <span class="text-text-muted">{field.name}</span>
          <span
            class="rounded-full px-3 py-1 text-xs font-semibold"
            style={fieldInputs[field.id]
              ? 'background: var(--color-brand); color: #06140c;'
              : 'background: var(--color-surface-2); color: var(--color-text-muted);'}
          >{fieldInputs[field.id] ? 'Yes' : 'No'}</span>
        </button>
      {/if}
    {/each}

    {#if !isAges}
      <div>
        <p class="mb-1.5 text-sm text-text-muted">Tags</p>
        <TagInput bind:tags />
      </div>

      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Note</span>
        <textarea
          bind:value={note}
          rows="2"
          class="w-full resize-none rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        ></textarea>
      </label>
    {/if}

    {#if error}
      <p class="text-sm" style="color: #f87171;">{error}</p>
    {/if}

    <div class="flex gap-2">
      {#if entry}
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
{/if}
