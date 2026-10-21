<script lang="ts" generics="T extends string">
  let { options, value = $bindable() }: { options: { id: T; label: string }[]; value: T } = $props();
</script>

<div class="flex overflow-hidden rounded-full border" style="border-color: var(--color-border);">
  {#each options as o (o.id)}
    <button
      type="button"
      class="px-2.5 py-1 text-xs font-medium"
      style={value === o.id ? 'background: var(--color-brand); color: #06140c;' : 'color: var(--color-text-muted);'}
      aria-pressed={value === o.id}
      onclick={() => (value = o.id)}
    >{o.label}</button>
  {/each}
</div>
