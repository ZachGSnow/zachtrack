<script lang="ts">
  import { formatDuration, formatHoursShort } from '../utils/time';
  import { ZONES } from '../data/zones';
  import { zoneInfoStore } from '../stores/zoneInfo.svelte';

  let {
    elapsedMs,
    elapsedHrs,
    targetHours,
    progress,
    color,
    onTimeClick,
  }: {
    elapsedMs: number;
    elapsedHrs: number;
    targetHours?: number;
    progress: number | null;
    color: string;
    onTimeClick?: () => void;
  } = $props();

  const size = 280;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // The ring is a 300deg gauge (not a full circle) so the start and end points
  // never overlap visually -- there's a 60deg gap centered at the bottom.
  const GAP_DEG = 60;
  const SWEEP_DEG = 360 - GAP_DEG;
  const START_ANGLE_FROM_TOP = 180 + GAP_DEG / 2; // 210deg, measuring clockwise from 12 o'clock
  const ROTATION_DEG = START_ANGLE_FROM_TOP - 90; // CSS rotation to apply to the raw (east-starting) circle

  const visibleLen = circumference * (SWEEP_DEG / 360);

  // With no target, cycle the ring once every 24h so there's still motion
  // and visual feedback for open-ended fasts.
  const fraction = $derived(progress ?? (elapsedHrs % 24) / 24);
  const clampedFraction = $derived(Math.min(1, Math.max(0, fraction)));
  const progressLen = $derived(visibleLen * clampedFraction);

  // The lap this ring represents: the fast's target hours, or a 24h rolling
  // lap for open-ended/custom fasts. Zone boundaries beyond this don't get a
  // marker on the current lap.
  const lapHours = $derived(targetHours ?? 24);

  const markers = $derived(
    ZONES.filter((z) => z.hourStart > 0 && z.hourStart <= lapHours).map((z) => {
      const angleFromTop = (START_ANGLE_FROM_TOP + (z.hourStart / lapHours) * SWEEP_DEG) % 360;
      const angleRad = (angleFromTop * Math.PI) / 180;
      return {
        zoneId: z.id,
        color: z.color,
        x: cx + radius * Math.sin(angleRad),
        y: cy - radius * Math.cos(angleRad),
      };
    }),
  );
</script>

<div class="relative" style="width: {size}px; height: {size}px;">
  <svg width={size} height={size} style="transform: rotate({ROTATION_DEG}deg);">
    <circle
      {cx}
      {cy}
      r={radius}
      fill="none"
      stroke="var(--color-surface-2)"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray="{visibleLen} {circumference}"
    />
    <circle
      {cx}
      {cy}
      r={radius}
      fill="none"
      stroke={color}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray="{progressLen} {circumference}"
      style="filter: drop-shadow(0 0 8px {color}80); transition: stroke-dasharray 0.6s linear, stroke 0.6s ease;"
    />
  </svg>
  <svg width={size} height={size} class="absolute inset-0">
    {#each markers as marker (marker.zoneId)}
      <g>
        <circle
          cx={marker.x}
          cy={marker.y}
          r="14"
          fill="transparent"
          role="button"
          tabindex="0"
          aria-label="View zone info"
          style="cursor: pointer; pointer-events: all;"
          onclick={() => zoneInfoStore.show(marker.zoneId)}
          onkeydown={(e) => e.key === 'Enter' && zoneInfoStore.show(marker.zoneId)}
        />
        <circle cx={marker.x} cy={marker.y} r="6" fill={marker.color} stroke="var(--color-bg)" stroke-width="2" style="pointer-events: none;" />
      </g>
    {/each}
  </svg>
  <div class="absolute inset-0 flex flex-col items-center justify-center gap-1">
    <button
      type="button"
      class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1"
      style="pointer-events: {onTimeClick ? 'auto' : 'none'};"
      onclick={onTimeClick}
      aria-label="Edit start time"
    >
      <span class="font-mono text-4xl font-semibold tabular-nums text-text">{formatDuration(elapsedMs)}</span>
      {#if targetHours}
        <span class="text-sm text-text-muted">of {formatHoursShort(targetHours)} goal</span>
      {:else}
        <span class="text-sm text-text-muted">elapsed</span>
      {/if}
      {#if onTimeClick}
        <span class="text-[10px] uppercase tracking-wide text-text-muted">Tap to edit start time</span>
      {/if}
    </button>
  </div>
</div>
