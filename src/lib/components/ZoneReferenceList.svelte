<script lang="ts">
  import { ZONES } from '../data/zones';

  let { currentZoneId = null }: { currentZoneId?: string | null } = $props();

  const zones = ZONES.filter((z) => z.hourStart < 24);

  let expanded = $state<Set<string>>(new Set());

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expanded = next;
  }
</script>

<div class="w-full">
  <p class="mb-2 text-sm font-medium text-text-muted">Biological zones (first 24 hours)</p>
  <ul class="flex flex-col gap-2">
    {#each zones as zone (zone.id)}
      <li
        class="rounded-xl border p-3"
        style="border-color: {zone.id === currentZoneId ? zone.color + '80' : 'var(--color-border)'}; background: {zone.id === currentZoneId ? zone.color + '14' : 'var(--color-surface)'};"
      >
        <button class="flex w-full items-center justify-between gap-2 text-left" onclick={() => toggle(zone.id)}>
          <div class="flex items-center gap-2">
            <span class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background: {zone.color};"></span>
            <div>
              <p class="text-sm font-medium text-text">
                {zone.title}
                {#if zone.id === currentZoneId}
                  <span class="ml-1 text-xs font-normal" style="color: {zone.color};">(current)</span>
                {/if}
              </p>
              <p class="text-xs text-text-muted">{zone.hourStart}-{zone.hourEnd}h &middot; {zone.summary}</p>
            </div>
          </div>
          <span class="shrink-0 text-sm text-text-muted">{expanded.has(zone.id) ? '\u2212' : '+'}</span>
        </button>
        {#if expanded.has(zone.id)}
          <div class="mt-3 space-y-2 text-sm text-text-muted">
            <p><span class="font-semibold text-text">Energy source: </span>{zone.energySource}</p>
            <p><span class="font-semibold text-text">The science: </span>{zone.science}</p>
            <p><span class="font-semibold text-text">What's happening: </span>{zone.whatsHappening}</p>
            <p><span class="font-semibold text-text">What you may feel: </span>{zone.userExperience}</p>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>
