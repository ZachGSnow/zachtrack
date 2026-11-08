<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  // The app's buttons. `primary` is the one action on a screen (Start Fast,
  // Save); `secondary` is bordered; `ghost` is text only; `danger` is for
  // deleting and signing out.
  let {
    variant = 'secondary',
    size = 'md',
    class: cls = '',
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    class?: string;
    children: Snippet;
  } = $props();

  const VARIANTS: Record<NonNullable<typeof variant>, string> = {
    primary: 'bg-brand text-brand-fg font-semibold active:bg-brand-dim',
    secondary: 'border border-border bg-surface text-text active:bg-surface-2',
    ghost: 'text-text-muted active:bg-surface-2',
    danger: 'border border-danger-line text-danger active:bg-danger-soft',
  };
  const SIZES: Record<NonNullable<typeof size>, string> = {
    sm: 'min-h-8 rounded-full px-3 text-xs',
    md: 'min-h-10 rounded-xl px-4 text-sm',
    lg: 'min-h-12 w-full rounded-2xl px-5 text-base',
  };
</script>

<button
  type="button"
  {...rest}
  class="inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 {VARIANTS[variant]} {SIZES[size]} {cls}"
>
  {@render children()}
</button>
