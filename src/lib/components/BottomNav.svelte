<script lang="ts">
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';

  const items = [
    { href: '/', label: 'Fasting', icon: '\u23f1' },
    { href: '/trackables', label: 'Trackables', icon: '\ud83d\udccb' },
    { href: '/journey', label: 'Journey', icon: '\ud83d\udcc8' },
    { href: '/charting', label: 'Data', icon: '\ud83d\udd00' },
    { href: '/history', label: 'History', icon: '\ud83d\udcdc' },
  ];
</script>

<nav
  class="sticky bottom-0 z-10 flex justify-around border-t bg-surface/95 backdrop-blur"
  style="border-color: var(--color-border);"
>
  {#each items as item (item.href)}
    <a
      href={item.href}
      use:link
      use:active={{ path: item.href === '/' ? '/' : `${item.href}/*`, className: 'active' }}
      class="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium"
    >
      <span class="text-lg leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </a>
  {/each}
</nav>

<style>
  a {
    color: var(--color-text-muted);
  }
  a:global(.active) {
    color: var(--color-brand);
  }
</style>
