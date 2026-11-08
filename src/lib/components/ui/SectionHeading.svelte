<script lang="ts">
  import type { Snippet } from 'svelte';

  // The small uppercase label above a group of cards, with room for an action
  // on the right ("See all", a help link).
  let {
    title,
    id,
    tone = 'muted',
    class: cls = '',
    action,
  }: {
    title: string;
    /** For aria-labelledby on the section it heads. */
    id?: string;
    tone?: 'muted' | 'danger' | 'warn' | 'brand';
    class?: string;
    action?: Snippet;
  } = $props();

  const TONES: Record<NonNullable<typeof tone>, string> = {
    muted: 'text-text-muted',
    danger: 'text-danger',
    warn: 'text-warn',
    brand: 'text-brand',
  };
</script>

<div class="flex items-center justify-between gap-2 {cls}">
  <h2 {id} class="text-xs font-semibold tracking-wide uppercase {TONES[tone]}">{title}</h2>
  {#if action}
    {@render action()}
  {/if}
</div>
