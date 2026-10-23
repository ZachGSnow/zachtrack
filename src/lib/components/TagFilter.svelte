<script lang="ts">
  // One-tag filter for a list (fasts in History, entries on a trackable): tap
  // a tag to show only items with it, tap it again or "All" to clear. Tags are
  // ordered by how often they're used. Hidden when nothing has tags.
  let { items, selected = $bindable(null) }: { items: { tags?: string[] }[]; selected: string | null } = $props();

  const tags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const item of items) for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  });

  // A tag that no longer exists (its last item deleted or edited) clears the filter.
  $effect(() => {
    if (selected != null && !tags.some((t) => t.tag === selected)) selected = null;
  });
</script>

{#if tags.length > 0}
  <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
    <button
      type="button"
      class="rounded-full border px-2.5 py-1 text-xs font-medium"
      style={selected == null
        ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
        : 'border-color: var(--color-border); color: var(--color-text-muted);'}
      aria-pressed={selected == null}
      onclick={() => (selected = null)}
    >All</button>
    {#each tags as t (t.tag)}
      <button
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs font-medium"
        style={selected === t.tag
          ? 'background: var(--color-brand); color: #06140c; border-color: var(--color-brand);'
          : 'border-color: var(--color-border); color: var(--color-text-muted);'}
        aria-pressed={selected === t.tag}
        onclick={() => (selected = selected === t.tag ? null : t.tag)}
      >#{t.tag} <span class="opacity-60">{t.count}</span></button>
    {/each}
  </div>
{/if}
