<script lang="ts">
  import { PRESETS } from '../data/presets';

  let {
    selectedId = $bindable(),
  }: {
    selectedId: string;
  } = $props();
</script>

<div class="w-full">
  <p class="mb-2 text-sm font-medium text-text-muted">Choose a method</p>
  <div class="flex flex-wrap gap-2">
    {#each PRESETS as preset (preset.id)}
      <button
        class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
        class:selected={selectedId === preset.id}
        style={selectedId === preset.id
          ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
          : 'background: var(--color-surface-2); color: var(--color-text); border-color: var(--color-border);'}
        onclick={() => (selectedId = preset.id)}
      >
        {preset.label}
      </button>
    {/each}
  </div>
  {#if selectedId}
    <p class="mt-2 text-xs text-text-muted">
      {PRESETS.find((p) => p.id === selectedId)?.description}
    </p>
  {/if}
</div>
