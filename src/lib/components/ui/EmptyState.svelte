<script lang="ts">
  import type { Snippet } from 'svelte';

  // What a screen shows before it has anything: an emoji or icon, a line
  // saying so, and the one thing to do about it.
  let {
    icon,
    title,
    text,
    class: cls = '',
    action,
  }: {
    /** An emoji, or leave it out and pass an icon through `action`'s sibling snippet. */
    icon?: string;
    title: string;
    text?: string;
    class?: string;
    action?: Snippet;
  } = $props();
</script>

<div class="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center {cls}">
  {#if icon}
    <span class="text-3xl" aria-hidden="true">{icon}</span>
  {/if}
  <p class="font-heading text-base font-semibold text-text">{title}</p>
  {#if text}
    <p class="max-w-xs text-sm text-text-muted">{text}</p>
  {/if}
  {#if action}
    <div class="mt-2">
      {@render action()}
    </div>
  {/if}
</div>
