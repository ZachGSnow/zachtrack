<script lang="ts" generics="T extends string">
  // A row of pill buttons where one is selected: ranges (7d, 30d), views
  // (Table, Chart), the theme. Bind `value`, or pass `onchange` to act on a pick.
  let {
    options,
    value = $bindable(),
    onchange,
    label,
  }: {
    options: { id: T; label: string }[];
    value: T;
    onchange?: (value: T) => void;
    /** aria-label for the group. */
    label?: string;
  } = $props();

  function pick(id: T) {
    value = id;
    onchange?.(id);
  }
</script>

<div class="flex overflow-hidden rounded-full border border-border bg-surface" role="group" aria-label={label}>
  {#each options as o (o.id)}
    <button
      type="button"
      class="min-h-7 px-2.5 py-1 text-xs font-medium transition-colors {value === o.id ? 'bg-brand text-brand-fg' : 'text-text-muted'}"
      aria-pressed={value === o.id}
      onclick={() => pick(o.id)}
    >{o.label}</button>
  {/each}
</div>
