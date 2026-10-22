<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import { settingsStore } from '../stores/settings.svelte';
  import { BODY_FIELD_SETTING, resolveBodyFieldIds, type BodyFatSex } from '../utils/health';
  import { PRESETS } from '../data/presets';
  import DataFileSection from './DataFileSection.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  const allFields = liveQuery(() => db.fieldDefinitions.orderBy('name').toArray());
  const allTrackables = liveQuery(() => db.trackableDefinitions.toArray());

  /** Number fields, each labelled with the trackables it belongs to. */
  const numberFieldOptions = $derived(
    ($allFields ?? [])
      .filter((f) => f.kind === 'number')
      .map((f) => {
        const owners = ($allTrackables ?? []).filter((t) => t.fieldIds.includes(f.id)).map((t) => t.name);
        return { id: f.id, label: owners.length ? `${f.name} (${owners.join(', ')})` : f.name };
      }),
  );
  const bodyFieldIds = $derived(resolveBodyFieldIds($allFields ?? [], settingsStore.data));
  const weightFieldId = $derived(bodyFieldIds.weight ?? '');

  const BODY_FAT_FIELDS = [
    { role: 'waist', label: 'Waist field' },
    { role: 'neck', label: 'Neck field' },
    { role: 'hip', label: 'Hip field (female formula only)' },
  ] as const;

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
    <span class="mt-1 block text-xs text-text-muted">Used to compute BMI from your weight field.</span>
  </label>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Weight field</span>
    <select
      value={weightFieldId}
      onchange={(e) => settingsStore.update({ weightFieldId: (e.target as HTMLSelectElement).value || undefined })}
      class="w-full rounded-lg border bg-transparent p-2 text-text"
      style="border-color: var(--color-border);"
    >
      {#if !weightFieldId}
        <option value="">Not set</option>
      {/if}
      {#each numberFieldOptions as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
    <span class="mt-1 block text-xs text-text-muted">The field BMI and the goal line follow, whatever it is named.</span>
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
    <span class="mt-1 block text-xs text-text-muted">Shown as a dashed goal line on your weight field's charts.</span>
  </label>

  <div class="space-y-2 rounded-lg border p-3" style="border-color: var(--color-border);">
    <p class="text-sm font-medium text-text">Body fat (Navy method)</p>
    <p class="text-xs text-text-muted">
      Estimated from waist, neck, hip and height on each day you log them together, shown next to BMI. Field units
      must be in or cm. An estimate, typically within 3 to 4 points.
    </p>
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Formula</span>
      <select
        value={settingsStore.data.bodyFatSex ?? ''}
        onchange={(e) => settingsStore.update({ bodyFatSex: ((e.target as HTMLSelectElement).value || undefined) as BodyFatSex | undefined })}
        class="w-full rounded-lg border bg-transparent p-2 text-text"
        style="border-color: var(--color-border);"
      >
        <option value="">Off</option>
        <option value="male">Male (waist, neck)</option>
        <option value="female">Female (waist, hip, neck)</option>
      </select>
    </label>
    {#each BODY_FAT_FIELDS as item (item.role)}
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">{item.label}</span>
        <select
          value={bodyFieldIds[item.role] ?? ''}
          onchange={(e) => settingsStore.update({ [BODY_FIELD_SETTING[item.role]]: (e.target as HTMLSelectElement).value || undefined })}
          class="w-full rounded-lg border bg-transparent p-2 text-text"
          style="border-color: var(--color-border);"
        >
          {#if !bodyFieldIds[item.role]}
            <option value="">Not set</option>
          {/if}
          {#each numberFieldOptions as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>
    {/each}
  </div>

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
