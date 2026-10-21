<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type FastRecord } from '../lib/db';
  import { formatDateTime, formatHoursShort } from '../lib/utils/time';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import EditFastSheet from '../lib/components/EditFastSheet.svelte';

  const fasts = liveQuery(() => db.fasts.orderBy('startTime').reverse().toArray());

  let sheetOpen = $state(false);
  let selectedFast = $state<FastRecord | null>(null);

  function openFast(fast: FastRecord) {
    selectedFast = fast;
    sheetOpen = true;
  }
</script>

<div class="flex flex-1 flex-col gap-3 px-5 py-6">
  <h1 class="text-xl font-semibold text-text">History</h1>

  {#if $fasts === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if $fasts.length === 0}
    <p class="mt-8 text-center text-sm text-text-muted">No fasts logged yet. Start one from the Timer tab.</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each $fasts as fast (fast.id)}
        <li>
          <button
            class="w-full rounded-xl border p-3 text-left"
            style="border-color: var(--color-border); background: var(--color-surface);"
            onclick={() => openFast(fast)}
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-text">
                {fast.presetLabel ?? 'Custom fast'}
              </span>
              <span class="text-xs text-text-muted">{formatDateTime(fast.startTime)}</span>
            </div>
            <p class="mt-1 text-sm text-text-muted">
              {#if fast.endTime}
                Duration: {formatHoursShort((fast.endTime - fast.startTime) / 3600000)}
              {:else}
                <span style="color: var(--color-brand);">In progress&hellip;</span>
              {/if}
            </p>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<BottomSheet bind:open={sheetOpen}>
  <EditFastSheet bind:open={sheetOpen} fast={selectedFast} />
</BottomSheet>
