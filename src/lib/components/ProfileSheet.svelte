<script lang="ts">
  import { settingsStore } from '../stores/settings.svelte';
  import { PRESETS } from '../data/presets';
  import DataFileSection from './DataFileSection.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let heightDraft = $state('');
  let goalWeightDraft = $state('');

  $effect(() => {
    if (!open) return;
    heightDraft = settingsStore.data.heightInches?.toString() ?? '';
    goalWeightDraft = settingsStore.data.goalWeightLb?.toString() ?? '';
  });

  function saveHeight() {
    const val = heightDraft.trim() ? Number(heightDraft) : undefined;
    if (val != null && Number.isNaN(val)) return;
    settingsStore.update({ heightInches: val });
  }

  function saveGoalWeight() {
    const val = goalWeightDraft.trim() ? Number(goalWeightDraft) : undefined;
    if (val != null && Number.isNaN(val)) return;
    settingsStore.update({ goalWeightLb: val });
  }
</script>

<div class="space-y-4">
  <div class="flex items-baseline justify-between">
    <h2 class="text-lg font-semibold text-text">Profile</h2>
    <!-- Which build this device is running; the service worker updates on its own schedule. -->
    <span class="text-xs text-text-muted" title="ZachTrack version">v{__APP_VERSION__}</span>
  </div>
  <p class="text-xs text-text-muted">Export and import are under Your data, at the bottom.</p>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Height (in)</span>
    <input
      type="text"
      inputmode="decimal"
      placeholder="e.g. 68"
      bind:value={heightDraft}
      onblur={saveHeight}
      class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted"
      style="border-color: var(--color-border);"
    />
    <span class="mt-1 block text-xs text-text-muted">Used to compute BMI wherever you log Weight.</span>
  </label>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Desired weight (lb)</span>
    <input
      type="text"
      inputmode="decimal"
      placeholder="e.g. 175"
      bind:value={goalWeightDraft}
      onblur={saveGoalWeight}
      class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted"
      style="border-color: var(--color-border);"
    />
    <span class="mt-1 block text-xs text-text-muted">Shown as a dashed goal line on Weight charts.</span>
  </label>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Default fasting method</span>
    <select
      value={settingsStore.data.defaultPresetId}
      onchange={(e) => settingsStore.update({ defaultPresetId: (e.target as HTMLSelectElement).value })}
      class="w-full rounded-lg border bg-transparent p-2 text-text"
      style="border-color: var(--color-border);"
    >
      {#each PRESETS as preset (preset.id)}
        <option value={preset.id}>{preset.label}</option>
      {/each}
    </select>
  </label>

  <button
    type="button"
    class="flex w-full items-center justify-between rounded-lg border p-2 text-sm"
    style="border-color: var(--color-border);"
    onclick={() => settingsStore.update({ notificationsEnabled: !settingsStore.data.notificationsEnabled })}
  >
    <span class="text-text-muted">Zone milestone notifications</span>
    <span
      class="rounded-full px-3 py-1 text-xs font-semibold"
      style={settingsStore.data.notificationsEnabled
        ? 'background: var(--color-brand); color: #06140c;'
        : 'background: var(--color-surface-2); color: var(--color-text-muted);'}
    >{settingsStore.data.notificationsEnabled ? 'On' : 'Off'}</span>
  </button>

  <DataFileSection />

  <button
    class="w-full rounded-xl py-2.5 text-sm font-semibold"
    style="background: var(--color-brand); color: #06140c;"
    onclick={() => (open = false)}
  >Done</button>
</div>
