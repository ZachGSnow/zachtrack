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

<!-- Escape closes it, as a dialog should on a keyboard. -->
<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 lg:items-center lg:p-6"
    transition:fade={{ duration: 150 }}
    onclick={close}
    role="presentation"
  >
    <div
      class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t p-4 lg:max-w-lg lg:rounded-2xl lg:border"
      style="border-color: var(--color-border); background: var(--color-surface); padding-bottom: calc(1rem + env(safe-area-inset-bottom));"
      transition:fly={{ y: 300, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- The drag handle only means something on a phone's bottom sheet. -->
      <div class="mx-auto mb-3 h-1 w-10 rounded-full lg:hidden" style="background: var(--color-border);"></div>
      {@render children?.()}
    </div>
  </div>
{/if}
