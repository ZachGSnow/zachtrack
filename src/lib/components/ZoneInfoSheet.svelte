<script lang="ts">
  import { ZONES } from '../data/zones';
  import { zoneInfoStore } from '../stores/zoneInfo.svelte';
  import BottomSheet from './BottomSheet.svelte';

  const zone = $derived(ZONES.find((z) => z.id === zoneInfoStore.openZoneId) ?? null);

  let open = $state(false);
  $effect(() => {
    open = zoneInfoStore.openZoneId != null;
  });
  $effect(() => {
    if (!open) zoneInfoStore.close();
  });
</script>

<BottomSheet bind:open>
  {#if zone}
    <div class="space-y-3">
      <p class="text-xs font-medium uppercase tracking-wide" style="color: {zone.color};">
        {zone.hourEnd === Infinity ? `${zone.hourStart}h+` : `${zone.hourStart}-${zone.hourEnd}h`}
      </p>
      <h2 class="text-lg font-semibold text-text">{zone.title}</h2>
      <p class="text-sm text-text-muted">{zone.summary}</p>
      <div class="space-y-3 text-sm text-text-muted">
        <p><span class="font-semibold text-text">Energy source: </span>{zone.energySource}</p>
        <p><span class="font-semibold text-text">The science: </span>{zone.science}</p>
        <p><span class="font-semibold text-text">What's happening: </span>{zone.whatsHappening}</p>
        <p><span class="font-semibold text-text">What you may feel: </span>{zone.userExperience}</p>
      </div>
    </div>
  {/if}
</BottomSheet>
