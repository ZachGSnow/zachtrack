<script lang="ts">
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import Settings from '@lucide/svelte/icons/settings';
  import { attentionStore } from '../stores/attention.svelte';
  import { fastTimer } from '../stores/fast.svelte';
  import SyncStatus from './SyncStatus.svelte';
  import { SECTIONS } from '../data/sections';

  // 'bottom': the phone tab bar (hidden on wide screens); 'side': the sidebar
  // that replaces it from the lg breakpoint (1024px) up.
  let { variant = 'bottom' }: { variant?: 'bottom' | 'side' } = $props();

  // Help and Settings are active on their own page and the pages under it (/help/:topic).
  const activePath = (href: string) => new RegExp(`^${href}(/.*)?$`);

  // In-app reminders: how many trackables are due or overdue, and a dot on Fasting while a scheduled
  // fast is late or a running fast has reached a milestone you have not seen.
  const badge = (href: string): { text: string; label: string } | null => {
    if (href === '/trackables' && attentionStore.items.length > 0) {
      const n = attentionStore.items.length;
      return { text: String(n), label: `${n} need${n === 1 ? 's' : ''} attention` };
    }
    if (href === '/tasks' && attentionStore.tasksDue > 0) {
      const n = attentionStore.tasksDue;
      return { text: String(n), label: `${n} task${n === 1 ? '' : 's'} due` };
    }
    if (href === '/fasting' && attentionStore.fastingLate) return { text: '', label: 'fast is late' };
    if (href === '/fasting' && fastTimer.milestone) return { text: '', label: 'new fasting milestone' };
    return null;
  };

  // A page link that also stays marked on the pages under it: one trackable, one project.
  const SUB_PATHS: Record<string, RegExp> = {
    '/trackables': /^\/trackables(\/.*)?$/,
    '/tasks': /^\/tasks(\/(?!upcoming$|done$).*)?$/,
  };

  // The sections (data/sections.ts); a section's tab is lit on any of its pages.
  const items = SECTIONS;
</script>

{#if variant === 'side'}
  <nav class="sticky top-0 hidden h-svh w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 py-5 lg:flex" aria-label="Main">
    <p class="px-3 font-heading text-lg font-semibold text-text">ZachTrack</p>
    <div class="mb-4 px-3 pt-2">
      <SyncStatus align="start" />
    </div>
    {#each items as item (item.href)}
      <a
        href={item.href}
        use:link
        use:active={{ path: item.match, className: 'active' }}
        class="side flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
      >
        <item.icon size={20} aria-hidden="true" />
        <span>{item.label}</span>
        {#if badge(item.href)}
          {@const b = badge(item.href)!}
          <span class="badge ml-auto" class:dot={!b.text} aria-label={b.label}>{b.text}</span>
        {/if}
      </a>
      <!-- A section's pages, indented under it, each one click away. -->
      {#each item.pages ?? [] as p (p.href)}
        <a
          href={p.href}
          use:link
          use:active={{ path: SUB_PATHS[p.href] ?? p.href, className: 'current' }}
          class="side sub flex items-center rounded-lg py-1.5 pr-3 pl-11 text-sm"
        >{p.label}</a>
      {/each}
    {/each}
    <a
      href="/help"
      use:link
      use:active={{ path: activePath('/help'), className: 'active' }}
      class="side mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
    >
      <CircleHelp size={20} aria-hidden="true" />
      <span>Help</span>
    </a>
    <a
      href="/settings"
      use:link
      use:active={{ path: activePath('/settings'), className: 'active' }}
      class="side flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
    >
      <Settings size={20} aria-hidden="true" />
      <span>Settings</span>
    </a>
    <p class="px-3 pt-1 text-xs text-text-muted">Press <kbd class="rounded border border-border bg-surface-2 px-1 font-mono">?</kbd> for keyboard shortcuts</p>
  </nav>
{:else}
  <nav class="sticky bottom-0 z-10 flex justify-around border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
    {#each items as item (item.href)}
      <a
        href={item.href}
        use:link
        use:active={{ path: item.match, className: 'active' }}
        class="flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium"
      >
        <span class="relative leading-none">
          <item.icon size={22} aria-hidden="true" />
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
    background: var(--color-danger);
    color: var(--color-brand-fg);
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
    background: var(--color-warn);
  }
  a.side:global(.active) {
    background: var(--color-surface-2);
  }
  /* A section's page links: the section stays lit, and the current page is marked in brand color. */
  a.sub:global(.current) {
    color: var(--color-brand);
    font-weight: 600;
  }
</style>
