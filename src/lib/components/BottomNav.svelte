<script lang="ts">
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import { attentionStore } from '../stores/attention.svelte';
  import SyncStatus from './SyncStatus.svelte';

  // 'bottom': the phone tab bar (hidden on wide screens); 'side': the sidebar
  // that replaces it from the lg breakpoint (1024px) up.
  let { variant = 'bottom' }: { variant?: 'bottom' | 'side' } = $props();

  // A tab is active on its own page and the pages under it (/trackables and /trackables/:id).
  // A '/trackables/*' pattern missed the page itself, so no tab lit up there.
  const activePath = (href: string) => (href === '/' ? '/' : new RegExp(`^${href}(/.*)?$`));

  // In-app reminders: how many trackables are due or overdue, and a dot while a scheduled fast is late.
  const badge = (href: string): { text: string; label: string } | null => {
    if (href === '/trackables' && attentionStore.items.length > 0) {
      const n = attentionStore.items.length;
      return { text: String(n), label: `${n} need${n === 1 ? 's' : ''} attention` };
    }
    if (href === '/' && attentionStore.fastingLate) return { text: '', label: 'fast is late' };
    return null;
  };

  const items = [
    { href: '/', label: 'Fasting', icon: '\u23f1' },
    { href: '/trackables', label: 'Trackables', icon: '\ud83d\udccb' },
    { href: '/journey', label: 'Journey', icon: '\ud83d\udcc8' },
    { href: '/charting', label: 'Data', icon: '\ud83d\udd00' },
    { href: '/history', label: 'History', icon: '\ud83d\udcdc' },
  ];
</script>

{#if variant === 'side'}
  <nav
    class="sticky top-0 hidden h-svh w-56 shrink-0 flex-col gap-1 border-r bg-surface px-3 py-5 lg:flex"
    style="border-color: var(--color-border);"
    aria-label="Main"
  >
    <p class="px-3 text-lg font-semibold text-text">ZachTrack</p>
    <div class="mb-4 px-3 pt-2">
      <SyncStatus align="start" />
    </div>
    {#each items as item (item.href)}
      <a
        href={item.href}
        use:link
        use:active={{ path: activePath(item.href), className: 'active' }}
        class="side flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
      >
        <span class="w-6 text-center text-lg leading-none">{item.icon}</span>
        <span>{item.label}</span>
        {#if badge(item.href)}
          {@const b = badge(item.href)!}
          <span class="badge ml-auto" class:dot={!b.text} aria-label={b.label}>{b.text}</span>
        {/if}
      </a>
    {/each}
    <a
      href="/settings"
      use:link
      use:active={{ path: activePath('/settings'), className: 'active' }}
      class="side mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
    >
      <span class="w-6 text-center text-lg leading-none">&#9881;</span>
      <span>Settings</span>
    </a>
  </nav>
{:else}
  <nav
    class="sticky bottom-0 z-10 flex justify-around border-t bg-surface/95 backdrop-blur lg:hidden"
    style="border-color: var(--color-border);"
    aria-label="Main"
  >
    {#each items as item (item.href)}
      <a
        href={item.href}
        use:link
        use:active={{ path: activePath(item.href), className: 'active' }}
        class="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium"
      >
        <span class="relative text-lg leading-none">
          {item.icon}
          {#if badge(item.href)}
            {@const b = badge(item.href)!}
            <span class="badge absolute -top-1.5 -right-3" class:dot={!b.text} aria-label={b.label}>{b.text}</span>
          {/if}
        </span>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  a {
    color: var(--color-text-muted);
  }
  a:global(.active) {
    color: var(--color-brand);
  }
  a.side:hover {
    background: var(--color-surface-2);
  }
  .badge {
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: #f87171;
    color: #1a0606;
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 1.1rem;
    text-align: center;
  }
  .badge.dot {
    min-width: 0.6rem;
    width: 0.6rem;
    height: 0.6rem;
    padding: 0;
    background: #fbbf24;
  }
  a.side:global(.active) {
    background: var(--color-surface-2);
  }
</style>
