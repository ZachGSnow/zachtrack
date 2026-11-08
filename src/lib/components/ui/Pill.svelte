<script lang="ts">
  import type { Snippet } from 'svelte';

  // A small rounded label: a tag, a status, a count.
  let {
    tone = 'muted',
    class: cls = '',
    children,
  }: {
    tone?: 'muted' | 'brand' | 'warn' | 'danger' | 'info';
    class?: string;
    children: Snippet;
  } = $props();

  const TONES: Record<NonNullable<typeof tone>, string> = {
    muted: 'border-border text-text-muted',
    brand: 'border-brand/40 bg-brand-soft text-brand',
    warn: 'border-warn/40 bg-warn-soft text-warn',
    danger: 'border-danger-line bg-danger-soft text-danger',
    info: 'border-info/40 text-info',
  };
</script>

<span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {TONES[tone]} {cls}">
  {@render children()}
</span>
