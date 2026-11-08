<script lang="ts">
  // A small labelled number: "Goal streak / 4 days". `tone` colours the value.
  let {
    label,
    value,
    sub,
    tone = 'default',
    class: cls = '',
  }: {
    label: string;
    value: string;
    /** A line under the value: "12 of 23", "since Oct 25". */
    sub?: string;
    tone?: 'default' | 'brand' | 'warn' | 'danger' | 'muted';
    class?: string;
  } = $props();

  const VALUE: Record<NonNullable<typeof tone>, string> = {
    default: 'text-text',
    brand: 'text-brand',
    warn: 'text-warn',
    danger: 'text-danger',
    muted: 'text-text-muted',
  };
</script>

<div class="rounded-2xl border border-border bg-surface p-3 {cls}">
  <p class="text-xs text-text-muted">{label}</p>
  <p class="mt-0.5 font-heading text-xl font-semibold {VALUE[tone]}">{value}</p>
  {#if sub}
    <p class="text-xs text-text-muted">{sub}</p>
  {/if}
</div>
