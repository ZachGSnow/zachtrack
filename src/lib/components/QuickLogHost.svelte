<script lang="ts">
  import { fly } from 'svelte/transition';
  import { quickLog } from '../stores/quickLog.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import LogTrackableEntrySheet from './LogTrackableEntrySheet.svelte';

  // The Log entry sheet, the undo toast and the error line for quick logging
  // (stores/quickLog.svelte.ts). Mounted once on each page that logs from a list.
</script>

{#if quickLog.undo}
  <div
    class="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[calc(100%-2.5rem)] max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg lg:bottom-6"
    role="status"
    transition:fly={{ y: 16, duration: 150 }}
  >
    <span class="truncate text-text">{quickLog.undo.message}</span>
    <button class="shrink-0 font-semibold text-brand" onclick={() => quickLog.undoNow()}>Undo</button>
  </div>
{/if}
{#if quickLog.error}
  <p class="px-5 text-sm text-danger">{quickLog.error}</p>
{/if}

<BottomSheet bind:open={quickLog.sheetOpen}>
  <LogTrackableEntrySheet bind:open={quickLog.sheetOpen} trackable={quickLog.sheetTrackable} defaultTimestamp={quickLog.sheetTimestamp} />
</BottomSheet>
