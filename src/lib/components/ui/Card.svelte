<script lang="ts">
  import type { Snippet } from 'svelte';

  // The surface everything sits on: a rounded, bordered panel. `tone` tints it
  // for a reminder (danger), a heads-up (warn) or a highlight (brand).
  let {
    tone = 'default',
    padding = 'p-3',
    class: cls = '',
    label,
    labelledby,
    children,
  }: {
    tone?: 'default' | 'brand' | 'warn' | 'danger' | 'muted';
    /** Tailwind padding classes; `p-0` for a card whose content sets its own. */
    padding?: string;
    class?: string;
    /** aria-label, which also makes the card a landmark (section). */
    label?: string;
    labelledby?: string;
    children: Snippet;
  } = $props();

  const TONES: Record<NonNullable<typeof tone>, string> = {
    default: 'border-border bg-surface',
    brand: 'border-brand/30 bg-brand-soft',
    warn: 'border-warn/35 bg-warn-soft',
    danger: 'border-danger-line bg-danger-soft',
    muted: 'border-border bg-surface-2',
  };
</script>

{#if label || labelledby}
  <section class="rounded-2xl border {TONES[tone]} {padding} {cls}" aria-label={label} aria-labelledby={labelledby}>
    {@render children()}
  </section>
{:else}
  <div class="rounded-2xl border {TONES[tone]} {padding} {cls}">
    {@render children()}
  </div>
{/if}
