<script lang="ts">
  import type { BioZone } from '../data/zones';
  import { zoneInfoStore } from '../stores/zoneInfo.svelte';

  let { zone }: { zone: BioZone } = $props();
</script>

<button
  class="w-full rounded-2xl border p-4 text-left transition-colors"
  style="border-color: {zone.color}40; background: linear-gradient(180deg, {zone.color}14, transparent);"
  onclick={() => zoneInfoStore.show(zone.id)}
>
  <div class="flex items-start justify-between gap-3">
    <div>
      <p class="text-xs font-medium uppercase tracking-wide" style="color: {zone.color};">
        Current biological zone
      </p>
      <h2 class="mt-0.5 text-lg font-semibold text-text">{zone.title}</h2>
      <p class="mt-1 text-sm text-text-muted">{zone.summary}</p>
    </div>
  </div>

  <span class="mt-3 inline-block text-sm font-medium" style="color: {zone.color};">Learn more</span>
</button>
