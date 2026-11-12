<script lang="ts">
  import { quickLog } from '../stores/quickLog.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import LogTrackableEntrySheet from './LogTrackableEntrySheet.svelte';

  // The Log entry sheet and the error line for quick logging (the undo message is UndoToast.svelte)
  // (stores/quickLog.svelte.ts). Mounted once on each page that logs from a list.
</script>

{#if quickLog.error}
  <p class="px-5 text-sm text-danger">{quickLog.error}</p>
{/if}

<BottomSheet bind:open={quickLog.sheetOpen}>
  <LogTrackableEntrySheet bind:open={quickLog.sheetOpen} trackable={quickLog.sheetTrackable} defaultTimestamp={quickLog.sheetTimestamp} />
</BottomSheet>
