<script lang="ts">
  let { tags = $bindable([]) }: { tags: string[] } = $props();
  let draft = $state('');

  function addTag() {
    const t = draft.trim();
    if (t && !tags.includes(t)) {
      tags = [...tags, t];
    }
    draft = '';
  }

  function removeTag(t: string) {
    tags = tags.filter((x) => x !== t);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }
</script>

<div>
  {#if tags.length > 0}
    <div class="mb-1.5 flex flex-wrap gap-1.5">
      {#each tags as t (t)}
        <span
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          style="background: var(--color-surface-2); color: var(--color-text);"
        >
          {t}
          <button type="button" onclick={() => removeTag(t)} class="text-text-muted" aria-label="Remove {t}">&times;</button>
        </span>
      {/each}
    </div>
  {/if}
  <input
    type="text"
    bind:value={draft}
    onkeydown={handleKeydown}
    placeholder="Add a tag (e.g. traveled) and press Enter"
    class="w-full rounded-lg border bg-transparent p-2 text-sm text-text placeholder:text-text-muted"
    style="border-color: var(--color-border);"
  />
</div>
