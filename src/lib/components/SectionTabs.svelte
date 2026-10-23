<script lang="ts">
  import { link, router } from 'svelte-spa-router';
  import { sectionFor } from '../data/sections';

  // The pages of the current section (Timer, Journey, History under Fasting;
  // List and Dates under Trackables) as tabs at the top of the page, on a
  // phone. On a laptop the sidebar lists them instead. Not shown on pages
  // inside a section, such as one trackable's page.
  const current = $derived(sectionFor(router.location));
</script>

{#if current.section?.pages && current.page}
  <nav class="px-5 pt-3 lg:hidden" aria-label="{current.section.label} pages">
    <div class="flex rounded-full border p-0.5 text-sm" style="border-color: var(--color-border); background: var(--color-surface);">
      {#each current.section.pages as p (p.href)}
        <a
          href={p.href}
          use:link
          aria-current={p.href === current.page.href ? 'page' : undefined}
          class="flex-1 rounded-full px-3 py-1.5 text-center font-medium"
          style={p.href === current.page.href
            ? 'background: var(--color-brand); color: #06140c;'
            : 'color: var(--color-text-muted);'}>{p.label}</a
        >
      {/each}
    </div>
  </nav>
{/if}
