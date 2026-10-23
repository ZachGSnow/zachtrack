<script lang="ts">
  import { allPresets, customPresetLabel, type CustomFastPreset } from '../data/presets';
  import { settingsStore } from '../stores/settings.svelte';

  let {
    selectedId = $bindable(),
  }: {
    selectedId: string;
  } = $props();

  // The built-in methods plus fast lengths you saved (settings.customFastPresets, synced).
  const custom = $derived(settingsStore.data.customFastPresets ?? []);
  const presets = $derived(allPresets(custom));

  /** Plain copies: the settings store's $state proxies can't be stored in IndexedDB (ARCHITECTURE.md 4.4). */
  const plain = (list: readonly CustomFastPreset[]): CustomFastPreset[] => list.map(({ id, label, targetHours }) => ({ id, label, targetHours }));

  let adding = $state(false);
  let hoursDraft = $state('');
  let error = $state('');

  async function addPreset() {
    const hours = Number(hoursDraft);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 240) {
      error = 'Enter the fast length in hours, from 1 to 240.';
      return;
    }
    const label = customPresetLabel(hours);
    const existing = presets.find((p) => p.targetHours === hours);
    if (existing) {
      selectedId = existing.id;
    } else {
      const preset: CustomFastPreset = { id: `custom-${crypto.randomUUID()}`, label, targetHours: hours };
      try {
        await settingsStore.update({ customFastPresets: [...plain(custom), preset] });
      } catch (e) {
        error = e instanceof Error ? e.message : 'Could not save it. Please try again.';
        return;
      }
      selectedId = preset.id;
    }
    adding = false;
    hoursDraft = '';
    error = '';
  }

  async function removePreset(id: string) {
    const next = plain(custom.filter((p) => p.id !== id));
    try {
      await settingsStore.update({ customFastPresets: next.length ? next : undefined });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove it. Please try again.';
      return;
    }
    if (selectedId === id) selectedId = settingsStore.data.defaultPresetId;
  }
</script>

<div class="w-full">
  <p class="mb-2 text-sm font-medium text-text-muted">Choose a method</p>
  <div class="flex flex-wrap gap-2">
    {#each presets as preset (preset.id)}
      {@const mine = custom.some((c) => c.id === preset.id)}
      <span class="inline-flex items-center">
        <button
          class="border px-3 py-1.5 text-sm font-medium transition-colors {mine ? 'rounded-l-full border-r-0' : 'rounded-full'}"
          class:selected={selectedId === preset.id}
          style={selectedId === preset.id
            ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
            : 'background: var(--color-surface-2); color: var(--color-text); border-color: var(--color-border);'}
          onclick={() => (selectedId = preset.id)}
        >
          {preset.label}
        </button>
        {#if mine}
          <button
            class="rounded-r-full border py-1.5 pr-2.5 pl-1.5 text-sm text-text-muted"
            style={selectedId === preset.id
              ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
              : 'background: var(--color-surface-2); border-color: var(--color-border);'}
            onclick={() => removePreset(preset.id)}
            aria-label="Remove {preset.label}"
          >&times;</button>
        {/if}
      </span>
    {/each}
    {#if !adding}
      <button
        class="rounded-full border border-dashed px-3 py-1.5 text-sm font-medium text-text-muted"
        style="border-color: var(--color-border);"
        onclick={() => (adding = true)}
      >+ Your own</button>
    {/if}
  </div>
  {#if error && !adding}
    <p class="mt-1 text-xs" style="color: #f87171;">{error}</p>
  {/if}
  {#if adding}
    <div class="mt-2 flex items-center gap-2">
      <label class="flex items-center gap-2 text-sm text-text-muted">
        Fast for
        <input
          type="text"
          inputmode="decimal"
          bind:value={hoursDraft}
          placeholder="15"
          class="w-16 rounded-lg border bg-transparent p-1.5 text-center text-text placeholder:text-text-muted"
          style="border-color: var(--color-border);"
          aria-label="Hours"
        />
        hours
      </label>
      <button class="rounded-lg px-3 py-1.5 text-sm font-semibold" style="background: var(--color-brand); color: #06140c;" onclick={addPreset}>Save</button>
      <button class="text-sm text-text-muted" onclick={() => {
        adding = false;
        error = '';
      }}>Cancel</button>
    </div>
    {#if error}
      <p class="mt-1 text-xs" style="color: #f87171;">{error}</p>
    {/if}
  {/if}
  {#if selectedId}
    <p class="mt-2 text-xs text-text-muted">
      {presets.find((p) => p.id === selectedId)?.description}
    </p>
  {/if}
</div>
