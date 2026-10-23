<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { BODY_FIELD_SETTING, resolveBodyFieldIds, type BodyFatSex } from '../lib/utils/health';
  import { allPresets } from '../lib/data/presets';
  import DataFileSection from '../lib/components/DataFileSection.svelte';
  import SyncHistory from '../lib/components/SyncHistory.svelte';
  import { syncStore } from '../lib/stores/sync.svelte';
  import type { CustomFastPreset } from '../lib/data/presets';

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

  // Fill the text boxes once the settings have loaded.
  let filled = false;
  $effect(() => {
    if (filled || !settingsStore.ready) return;
    filled = true;
    heightDraft = settingsStore.data.heightInches?.toString() ?? '';
    goalWeightDraft = settingsStore.data.goalWeightLb?.toString() ?? '';
  });

  const customFasts = $derived(settingsStore.data.customFastPresets ?? []);

  /** Plain copies: the settings store's $state proxies can't be stored in IndexedDB (ARCHITECTURE.md 4.4). */
  function removeCustomFast(id: string) {
    const next: CustomFastPreset[] = customFasts.filter((c) => c.id !== id).map(({ id, label, targetHours }) => ({ id, label, targetHours }));
    settingsStore.update({ customFastPresets: next.length ? next : undefined });
  }

  const SYNC_LABELS: Record<typeof syncStore.status, string> = {
    idle: 'Synced',
    syncing: 'Syncing...',
    error: 'Sync error',
    offline: 'Offline',
    unauthenticated: 'Login expired',
    local: 'Local only: no sync server, so data stays on this device',
  };

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

<div class="mx-auto flex w-full flex-1 flex-col gap-6 px-5 py-6 lg:max-w-3xl">
  <h1 class="text-xl font-semibold text-text">Settings</h1>

  <section class="space-y-4" aria-labelledby="settings-body">
  <h2 id="settings-body" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Body</h2>

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

  </section>

  <section class="space-y-4" aria-labelledby="settings-fasting">
  <h2 id="settings-fasting" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Fasting</h2>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Default fasting method</span>
    <select
      value={settingsStore.data.defaultPresetId}
      onchange={(e) => settingsStore.update({ defaultPresetId: (e.target as HTMLSelectElement).value })}
      class="w-full rounded-lg border bg-transparent p-2 text-text"
      style="border-color: var(--color-border);"
    >
      {#each allPresets(settingsStore.data.customFastPresets) as preset (preset.id)}
        <option value={preset.id}>{preset.label}</option>
      {/each}
    </select>
  </label>

  {#if customFasts.length > 0}
    <div class="text-sm">
      <p class="mb-1 text-text-muted">Your fast lengths</p>
      <ul class="flex flex-wrap gap-2">
        {#each customFasts as c (c.id)}
          <li class="flex items-center gap-1 rounded-full border px-3 py-1" style="border-color: var(--color-border);">
            <span class="text-text">{c.label}</span>
            <button class="text-text-muted" onclick={() => removeCustomFast(c.id)} aria-label="Remove {c.label}">&times;</button>
          </li>
        {/each}
      </ul>
      <p class="mt-1 text-xs text-text-muted">Add more with "+ Your own" on the Fasting tab.</p>
    </div>
  {/if}

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Daily fast start (optional)</span>
    <div class="flex gap-2">
      <input
        type="time"
        value={settingsStore.data.fastScheduleTime ?? ''}
        onchange={(e) => settingsStore.update({ fastScheduleTime: (e.target as HTMLInputElement).value || undefined })}
        class="flex-1 rounded-lg border bg-transparent p-2 text-text"
        style="border-color: var(--color-border); color-scheme: dark;"
      />
      {#if settingsStore.data.fastScheduleTime}
        <button
          type="button"
          class="rounded-lg border px-3 text-sm text-text-muted"
          style="border-color: var(--color-border);"
          onclick={() => settingsStore.update({ fastScheduleTime: undefined })}
        >Clear</button>
      {/if}
    </div>
    <span class="mt-1 block text-xs text-text-muted">
      The Fasting tab counts down to it and says when you're late. With notifications on, you get a reminder while the app is open.
    </span>
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

  </section>

  <section aria-label="Your data">
    <DataFileSection />
  </section>

  <section class="space-y-3" aria-labelledby="settings-sync">
    <h2 id="settings-sync" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Sync</h2>
    <div class="flex items-center justify-between gap-3 text-sm">
      <span class="text-text">{SYNC_LABELS[syncStore.status]}</span>
      {#if syncStore.status === 'unauthenticated'}
        <button class="rounded-lg px-3 py-1.5 text-sm font-semibold" style="background: var(--color-brand); color: #06140c;" onclick={() => syncStore.reauthenticate()}>Log in again</button>
      {:else if syncStore.status !== 'local'}
        <button class="rounded-lg border px-3 py-1.5 text-sm text-text-muted" style="border-color: var(--color-border);" onclick={() => syncStore.syncNow().catch(() => {})}>Sync now</button>
      {/if}
    </div>
    {#if syncStore.lastError}
      <p class="text-xs" style="color: #f87171;">{syncStore.lastError}</p>
    {/if}
    {#if syncStore.status !== 'local'}
      <p class="text-xs text-text-muted">
        {syncStore.waiting === 0
          ? 'Nothing waiting: the server has every change from this device.'
          : `${syncStore.waiting} ${syncStore.waiting === 1 ? 'change' : 'changes'} on this device waiting to sync.`}
      </p>
    {/if}
    <div class="rounded-lg border p-1.5" style="border-color: var(--color-border); background: var(--color-surface-2);">
      <SyncHistory />
    </div>
  </section>

  <section class="space-y-1 text-sm" aria-labelledby="settings-about">
    <h2 id="settings-about" class="text-sm font-semibold uppercase tracking-wide text-text-muted">About</h2>
    <!-- Which build this device is running; the service worker updates on its own schedule. -->
    <p class="text-text">ZachTrack v{__APP_VERSION__}</p>
    <p class="text-xs text-text-muted">
      The fasting zone descriptions are general information, not medical advice. Talk to a doctor before extended fasting.
    </p>
  </section>
</div>
