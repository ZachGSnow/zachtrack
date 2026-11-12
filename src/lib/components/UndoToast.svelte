<script lang="ts">
  import { fly } from 'svelte/transition';
  import { undoToast } from '../stores/undo.svelte';

  // The one undo message for the whole app (stores/undo.svelte.ts).
</script>

{#if undoToast.current}
  <div
    class="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[calc(100%-2.5rem)] max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg lg:bottom-6"
    role="status"
    transition:fly={{ y: 16, duration: 150 }}
  >
    <span class="truncate text-text">{undoToast.current.message}</span>
    <button class="shrink-0 font-semibold text-brand" onclick={() => undoToast.undo()}>Undo</button>
  </div>
{/if}
