<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    children,
  }: {
    open: boolean;
    children?: Snippet;
  } = $props();

  function close() {
    open = false;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
    transition:fade={{ duration: 150 }}
    onclick={close}
    role="presentation"
  >
    <div
      class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t p-4"
      style="border-color: var(--color-border); background: var(--color-surface); padding-bottom: calc(1rem + env(safe-area-inset-bottom));"
      transition:fly={{ y: 300, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="mx-auto mb-3 h-1 w-10 rounded-full" style="background: var(--color-border);"></div>
      {@render children?.()}
    </div>
  </div>
{/if}
