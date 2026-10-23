<script lang="ts">
  import { link } from 'svelte-spa-router';

  // A small "?" next to something that might need explaining, opening that topic in Help.
  let { topic, label }: { topic: string; label: string } = $props();
</script>

<a
  href="/help/{topic}"
  use:link
  class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none"
  style="border-color: var(--color-border); color: var(--color-text-muted);"
  aria-label="Help: {label}"
  title="Help: {label}">?</a
>
