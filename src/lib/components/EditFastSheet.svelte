<script lang="ts">
  import type { FastRecord } from '../db';
  import { updateFast, deleteFast, DuplicateStartDayError } from '../db';
  import { fastTimer } from '../stores/fast.svelte';
  import { toDatetimeLocal, fromDatetimeLocal } from '../utils/time';
  import TagInput from './TagInput.svelte';

  let {
    open = $bindable(false),
    fast,
  }: {
    open: boolean;
    fast: FastRecord | null;
  } = $props();

  let startLocal = $state('');
  let endLocal = $state('');
  let moodRating = $state<number | null>(null);
  let energyRating = $state<number | null>(null);
  let hungerRating = $state<number | null>(null);
  let tags = $state<string[]>([]);
  let note = $state('');
  let error = $state('');

  const isActive = $derived(fast != null && fast.endTime == null);

  $effect(() => {
    if (!open || !fast) return;
    startLocal = toDatetimeLocal(fast.startTime);
    endLocal = fast.endTime ? toDatetimeLocal(fast.endTime) : '';
    moodRating = fast.moodRating ?? null;
    energyRating = fast.energyRating ?? null;
    hungerRating = fast.hungerRating ?? null;
    tags = fast.tags ?? [];
    note = fast.note ?? '';
    error = '';
  });

  async function handleSave() {
    if (!fast?.id) return;
    const startTime = fromDatetimeLocal(startLocal);
    const endTime = endLocal ? fromDatetimeLocal(endLocal) : undefined;

    if (Number.isNaN(startTime) || (endLocal && Number.isNaN(endTime))) {
      error = 'Please enter valid dates.';
      return;
    }
    if (startTime > Date.now()) {
      error = 'Start time cannot be in the future.';
      return;
    }
    if (endTime != null && endTime <= startTime) {
      error = 'End time must be after the start time.';
      return;
    }

    try {
      await updateFast(fast.id, {
        startTime,
        ...(isActive
          ? {}
          : {
              endTime,
              moodRating: moodRating ?? undefined,
              energyRating: energyRating ?? undefined,
              hungerRating: hungerRating ?? undefined,
              tags: tags.length ? [...tags] : undefined,
              note: note.trim() || undefined,
            }),
      });

      if (fastTimer.activeFast?.id === fast.id) {
        await fastTimer.refreshActive();
      }
      open = false;
    } catch (e) {
      error = e instanceof DuplicateStartDayError ? e.message : e instanceof Error ? e.message : 'Could not save this fast. Please try again.';
    }
  }

  async function handleDelete() {
    if (!fast?.id) return;
    if (!confirm('Delete this fast? This cannot be undone.')) return;
    await deleteFast(fast.id);
    if (fastTimer.activeFast?.id === fast.id) {
      await fastTimer.refreshActive();
    }
    open = false;
  }
</script>

{#if fast}
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-text">
      {fast.presetLabel ?? 'Custom fast'}
      {#if isActive}<span class="ml-1 text-sm font-normal" style="color: var(--color-brand);">(in progress)</span>{/if}
    </h2>

    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Start time</span>
      <input
        type="datetime-local"
        bind:value={startLocal}
        class="w-full rounded-lg border bg-transparent p-2 text-text"
        style="border-color: var(--color-border);"
      />
    </label>

    {#if !isActive}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">End time</span>
        <input
          type="datetime-local"
          bind:value={endLocal}
          class="w-full rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        />
      </label>

      <div>
        <p class="mb-1.5 text-sm text-text-muted">Mood</p>
        <div class="flex gap-2">
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              class="flex-1 rounded-lg border py-2 text-sm"
              style={moodRating === n
                ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                : 'border-color: var(--color-border); color: var(--color-text-muted);'}
              onclick={() => (moodRating = moodRating === n ? null : n)}
            >{n}</button>
          {/each}
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-sm text-text-muted">Energy</p>
        <div class="flex gap-2">
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              class="flex-1 rounded-lg border py-2 text-sm"
              style={energyRating === n
                ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                : 'border-color: var(--color-border); color: var(--color-text-muted);'}
              onclick={() => (energyRating = energyRating === n ? null : n)}
            >{n}</button>
          {/each}
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-sm text-text-muted">Hunger</p>
        <div class="flex gap-2">
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              class="flex-1 rounded-lg border py-2 text-sm"
              style={hungerRating === n
                ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
                : 'border-color: var(--color-border); color: var(--color-text-muted);'}
              onclick={() => (hungerRating = hungerRating === n ? null : n)}
            >{n}</button>
          {/each}
        </div>
      </div>

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
      <button
        class="flex-1 rounded-xl border py-2.5 text-sm font-medium"
        style="border-color: #ef444460; color: #f87171;"
        onclick={handleDelete}
      >Delete</button>
      <button
        class="flex-1 rounded-xl py-2.5 text-sm font-semibold"
        style="background: var(--color-brand); color: #06140c;"
        onclick={handleSave}
      >Save</button>
    </div>
  </div>
{/if}
