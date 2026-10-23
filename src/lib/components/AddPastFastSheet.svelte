<script lang="ts">
  import { untrack } from 'svelte';
  import { addFast, DuplicateStartDayError } from '../db';
  import { allPresets, DEFAULT_PRESET_ID } from '../data/presets';
  import { settingsStore } from '../stores/settings.svelte';
  import { fromDatetimeLocal, toDatetimeLocal } from '../utils/time';
  import MethodPicker from './MethodPicker.svelte';

  // History > Log a past fast: a fast you didn't time, with its method, start and end.
  let { open = $bindable(false) }: { open: boolean } = $props();

  let presetId = $state(DEFAULT_PRESET_ID);
  let startLocal = $state('');
  let endLocal = $state('');
  let error = $state('');

  // Fill the defaults each time it opens; untracked, so a settings sync while it's open doesn't reset what you typed.
  $effect(() => {
    if (!open) return;
    untrack(fill);
  });

  function fill() {
    presetId = settingsStore.data.defaultPresetId ?? DEFAULT_PRESET_ID;
    const preset = allPresets(settingsStore.data.customFastPresets).find((p) => p.id === presetId);
    // Defaults: a fast as long as the method, ending at the last noon.
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    if (end.getTime() > Date.now()) end.setDate(end.getDate() - 1);
    startLocal = toDatetimeLocal(end.getTime() - (preset?.targetHours ?? 16) * 3600_000);
    endLocal = toDatetimeLocal(end.getTime());
    error = '';
  }

  async function save() {
    const start = fromDatetimeLocal(startLocal);
    const end = fromDatetimeLocal(endLocal);
    if (!startLocal || !endLocal || Number.isNaN(start) || Number.isNaN(end)) {
      error = 'Enter when the fast started and ended.';
      return;
    }
    if (end <= start) {
      error = 'The end must be after the start.';
      return;
    }
    if (end > Date.now()) {
      error = 'The end cannot be in the future. For a fast still going, start it on the Fasting tab.';
      return;
    }
    const preset = allPresets(settingsStore.data.customFastPresets).find((p) => p.id === presetId);
    const now = Date.now();
    try {
      await addFast({
        startTime: start,
        endTime: end,
        method: presetId === 'custom' ? 'custom' : 'preset',
        presetId,
        presetLabel: preset?.label,
        targetHours: preset?.targetHours,
        createdAt: now,
        updatedAt: now,
      });
      open = false;
    } catch (e) {
      error = e instanceof DuplicateStartDayError ? e.message : 'Could not save this fast. Please try again.';
    }
  }
</script>

<div class="space-y-4">
  <h2 class="text-lg font-semibold text-text">Log a past fast</h2>
  <MethodPicker bind:selectedId={presetId} />
  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Started</span>
    <input type="datetime-local" bind:value={startLocal} class="w-full rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);" />
  </label>
  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Ended</span>
    <input type="datetime-local" bind:value={endLocal} class="w-full rounded-lg border bg-transparent p-2 text-text" style="border-color: var(--color-border);" />
  </label>
  {#if error}<p class="text-sm" style="color: #f87171;">{error}</p>{/if}
  <button class="w-full rounded-xl py-2.5 text-sm font-semibold" style="background: var(--color-brand); color: #06140c;" onclick={save}>Save fast</button>
</div>
