<script lang="ts">
  import type { AwayLine } from '../utils/sinceLastVisit';
  import { visitStore } from '../stores/visit.svelte';

  // "Since you were last here" on Today (utils/sinceLastVisit.ts): what
  // happened while the app was closed, since it sends no notifications.
  let { lines, since }: { lines: AwayLine[]; since: number } = $props();

  const when = $derived.by(() => {
    const days = Math.round((Date.now() - since) / (24 * 3600_000));
    return days >= 2 ? `${days} days ago` : days === 1 ? 'yesterday' : 'earlier today';
  });
</script>

<section class="rounded-2xl border border-info/40 bg-surface p-3" aria-label="Since you were last here">
  <div class="flex items-baseline justify-between gap-2">
    <p class="text-xs font-semibold tracking-wide text-info uppercase">Since you were last here ({when})</p>
    <button class="text-xs text-text-muted" onclick={() => (visitStore.dismissed = true)}>Dismiss</button>
  </div>
  <ul class="mt-1 flex flex-col gap-1">
    {#each lines as line (line.text)}
      <li class="flex items-start gap-2 text-sm text-text">
        <span class="w-5 shrink-0 text-center" aria-hidden="true">{line.icon}</span>
        <span>{line.text}</span>
      </li>
    {/each}
  </ul>
</section>
