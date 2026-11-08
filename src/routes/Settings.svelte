<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, deleteFieldDefinition } from '../lib/db';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import { BODY_FIELD_SETTING, bodyFieldOptions, resolveBodyFieldIds, unusedFields, type BodyFatSex, type BodyFieldRole } from '../lib/utils/health';
  import { allPresets } from '../lib/data/presets';
  import DataFileSection from '../lib/components/DataFileSection.svelte';
  import ScaleImportSection from '../lib/components/ScaleImportSection.svelte';
  import { link } from 'svelte-spa-router';
  import HelpLink from '../lib/components/HelpLink.svelte';
  import SyncHistory from '../lib/components/SyncHistory.svelte';
  import SignOutSection from '../lib/components/SignOutSection.svelte';
  import WeekPlanEditor from '../lib/components/WeekPlanEditor.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import { THEME_CHOICES, themeStore } from '../lib/stores/theme.svelte';
  import { syncStore } from '../lib/stores/sync.svelte';
  import { GOAL_FAST_ID } from '../lib/utils/insights';
  import type { CustomFastPreset } from '../lib/data/presets';

  const allFields = liveQuery(() => db.fieldDefinitions.orderBy('name').toArray());
  const allTrackables = liveQuery(() => db.trackableDefinitions.toArray());

  const bodyFieldIds = $derived(resolveBodyFieldIds($allFields ?? [], settingsStore.data));

  /** A picker's fields for a role (utils/health.ts), each labelled with the trackables it belongs to. */
  function optionsFor(role: BodyFieldRole): { id: string; label: string }[] {
    return bodyFieldOptions($allFields ?? [], $allTrackables ?? [], role, bodyFieldIds[role]).map((f) => {
      const owners = ($allTrackables ?? []).filter((t) => t.fieldIds.includes(f.id)).map((t) => t.name);
      return { id: f.id, label: owners.length ? `${f.name} (${owners.join(', ')})` : `${f.name} (unused)` };
    });
  }

  // Fields no trackable uses any more: left behind by edits and deleted trackables.
  const unused = $derived(unusedFields($allFields ?? [], $allTrackables ?? []));
  let unusedOpen = $state(false);
  // Comparisons hidden from trackable pages (settings.mutedInsights), named from their keys.
  const hiddenInsights = $derived(
    (settingsStore.data.mutedInsights ?? []).map((key) => {
      const [id, otherId, after] = key.split('|');
      const name = (tid: string) => (tid === GOAL_FAST_ID ? 'a goal fast' : (($allTrackables ?? []).find((t) => t.id === tid)?.name ?? 'a deleted trackable'));
      return { key, label: `${name(id)} ${after === '1' ? 'the day after' : 'on days with'} ${name(otherId)}` };
    }),
  );
  function showInsight(key: string) {
    const next = (settingsStore.data.mutedInsights ?? []).filter((k) => k !== key);
    settingsStore.update({ mutedInsights: next.length ? [...next] : undefined });
  }

  async function removeUnused(fieldId: string) {
    const f = unused.find((u) => u.id === fieldId);
    if (!f || !confirm(`Delete the field "${f.name}"? Values logged under it stay in their entries but won't be shown.`)) return;
    await deleteFieldDefinition(fieldId);
  }
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

  <section class="space-y-3" aria-labelledby="settings-appearance">
    <h2 id="settings-appearance" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Appearance</h2>
    <div class="flex items-center justify-between gap-3 text-sm">
      <span class="text-text-muted">Theme</span>
      <SegmentedControl
        options={THEME_CHOICES}
        value={themeStore.choice}
        onchange={(choice) => themeStore.set(choice)}
      />
    </div>
    <p class="text-xs text-text-muted">System follows this device's light or dark setting. The choice is per device.</p>
  </section>

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
      class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border"
    />
    <span class="mt-1 block text-xs text-text-muted">Used to compute BMI from your weight field.</span>
  </label>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Weight field</span>
    <select
      value={weightFieldId}
      onchange={(e) => settingsStore.update({ weightFieldId: (e.target as HTMLSelectElement).value || undefined })}
      class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
    >
      {#if !weightFieldId}
        <option value="">Not set</option>
      {/if}
      {#each optionsFor('weight') as option (option.id)}
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
      class="w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border"
    />
    <span class="mt-1 block text-xs text-text-muted">Shown as a dashed goal line on your weight field's charts.</span>
  </label>

  <div class="space-y-2 rounded-lg border p-3 border-border">
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
        class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
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
          class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
        >
          {#if !bodyFieldIds[item.role]}
            <option value="">Not set</option>
          {/if}
          {#each optionsFor(item.role) as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>
    {/each}
  </div>

  </section>

  <section class="space-y-2" aria-labelledby="settings-fields">
    <h2 id="settings-fields" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Fields</h2>
    {#if unused.length === 0}
      <p class="text-sm text-text-muted">Every field belongs to a trackable.</p>
    {:else}
      <button class="text-sm text-text" onclick={() => (unusedOpen = !unusedOpen)} aria-expanded={unusedOpen}>
        {unusedOpen ? 'Hide' : 'Show'} unused fields ({unused.length})
      </button>
      <p class="text-xs text-text-muted">Fields no trackable uses, left behind by edits and deleted trackables. Deleting one syncs to your other devices.</p>
      {#if unusedOpen}
        <ul class="divide-y divide-border rounded-lg border border-border" aria-label="Unused fields">
          {#each unused as f (f.id)}
            <li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span class="min-w-0 truncate text-text">{f.name}{f.unit ? ` (${f.unit})` : ''}<span class="text-text-muted"> &middot; {f.kind}</span></span>
              <button class="shrink-0 text-xs font-medium text-danger" onclick={() => removeUnused(f.id)}>Delete</button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  {#if hiddenInsights.length > 0}
    <section class="space-y-2" aria-labelledby="settings-insights">
      <h2 id="settings-insights" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Hidden comparisons</h2>
      <p class="text-xs text-text-muted">Insights you hid on a trackable's page. Hiding syncs to your other devices.</p>
      <ul class="divide-y divide-border rounded-lg border border-border" aria-label="Hidden comparisons">
        {#each hiddenInsights as h (h.key)}
          <li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span class="min-w-0 truncate text-text">{h.label}</span>
            <button class="shrink-0 text-xs font-medium text-brand" onclick={() => showInsight(h.key)}>Show</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="space-y-4" aria-labelledby="settings-fasting">
  <h2 id="settings-fasting" class="text-sm font-semibold uppercase tracking-wide text-text-muted">Fasting</h2>

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Default fasting method</span>
    <select
      value={settingsStore.data.defaultPresetId}
      onchange={(e) => settingsStore.update({ defaultPresetId: (e.target as HTMLSelectElement).value })}
      class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
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
          <li class="flex items-center gap-1 rounded-full border px-3 py-1 border-border">
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
        class="flex-1 rounded-lg border bg-transparent p-2 text-text border-border"
      />
      {#if settingsStore.data.fastScheduleTime}
        <button
          type="button"
          class="rounded-lg border px-3 text-sm text-text-muted border-border"
          onclick={() => settingsStore.update({ fastScheduleTime: undefined })}
        >Clear</button>
      {/if}
    </div>
    <span class="mt-1 block text-xs text-text-muted">
      The Fasting tab counts down to it and says when you're late.
    </span>
  </label>

  <WeekPlanEditor />

  </section>

  <section aria-label="Your data">
    <DataFileSection />
    <ScaleImportSection />
  </section>

  <section class="space-y-3" aria-labelledby="settings-sync">
    <h2 id="settings-sync" class="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-text-muted"><span>Sync</span> <HelpLink topic="sync-page" label="devices, checking sync and signing out" /></h2>
    <div class="flex items-center justify-between gap-3 text-sm">
      <span class="text-text">{syncStore.status === 'unauthenticated' && syncStore.signedOut ? 'Signed out' : SYNC_LABELS[syncStore.status]}</span>
      {#if syncStore.status === 'unauthenticated'}
        <button class="rounded-lg px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg" onclick={() => syncStore.reauthenticate()}>Log in again</button>
      {:else if syncStore.status !== 'local'}
        <button class="rounded-lg border px-3 py-1.5 text-sm text-text-muted border-border" onclick={() => syncStore.syncNow().catch(() => {})}>Sync now</button>
      {/if}
    </div>
    {#if syncStore.lastError}
      <p class="text-xs text-danger">{syncStore.lastError}</p>
    {/if}
    {#if syncStore.status !== 'local'}
      <p class="text-xs text-text-muted">
        {syncStore.waiting === 0
          ? 'Nothing waiting: the server has every change from this device.'
          : `${syncStore.waiting} ${syncStore.waiting === 1 ? 'change' : 'changes'} on this device waiting to sync.`}
      </p>
    {/if}
    <div class="rounded-lg border p-1.5 border-border bg-surface-2">
      <SyncHistory limit={5} />
    </div>
    <a href="/sync" use:link class="block text-sm font-semibold text-brand"
      >Devices, activity on all devices, 30 days of syncs, and Check sync</a
    >
    {#if syncStore.status !== 'local'}
      <SignOutSection />
    {/if}
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
