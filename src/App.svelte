<script lang="ts">
  import Router, { link, push } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { onMount, tick } from 'svelte';
  import { SHORTCUTS, shortcutFor } from './lib/utils/keyboard';
  import { weighInTrackable } from './lib/weighIn';
  import { quickLog } from './lib/stores/quickLog.svelte';
  import BottomSheet from './lib/components/BottomSheet.svelte';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import Settings from '@lucide/svelte/icons/settings';
  import BottomNav from './lib/components/BottomNav.svelte';
  import SectionTabs from './lib/components/SectionTabs.svelte';
  import Today from './routes/Today.svelte';
  import Fasting from './routes/Fasting.svelte';
  import Trackables from './routes/Trackables.svelte';
  import History from './routes/History.svelte';
  import { fastTimer } from './lib/stores/fast.svelte';
  import { settingsStore } from './lib/stores/settings.svelte';
  import { syncStore } from './lib/stores/sync.svelte';
  import { attentionStore } from './lib/stores/attention.svelte';
  import { starterStore } from './lib/stores/starter.svelte';
  import { visitStore } from './lib/stores/visit.svelte';
  import ZoneInfoSheet from './lib/components/ZoneInfoSheet.svelte';
  import QuickAddSheet from './lib/components/QuickAddSheet.svelte';
  import UndoToast from './lib/components/UndoToast.svelte';
  import { quickAdd } from './lib/stores/quickAdd.svelte';
  import { taskSearch } from './lib/stores/taskSearch.svelte';
  import SyncStatus from './lib/components/SyncStatus.svelte';

  const routes = {
    '/': Today,
    // The timer, which was the home until Today arrived (v1.15.0).
    '/fasting': Fasting,
    '/trackables': Trackables,
    // Lazy-loaded: these pull in ECharts, so keep them out of the initial bundle.
    '/trackables/:id': wrap({ asyncComponent: () => import('./routes/TrackableDetailRoute.svelte') }),
    '/journey': wrap({ asyncComponent: () => import('./routes/Journey.svelte') }),
    '/insights': wrap({ asyncComponent: () => import('./routes/Insights.svelte') }),
    // The Data tab's old address, so links and bookmarks to it still work.
    '/charting': wrap({ asyncComponent: () => import('./routes/Insights.svelte') }),
    '/history': History,
    '/settings': wrap({ asyncComponent: () => import('./routes/Settings.svelte') }),
    '/sync': wrap({ asyncComponent: () => import('./routes/Sync.svelte') }),
    '/dates': wrap({ asyncComponent: () => import('./routes/Dates.svelte'), props: { view: 'list' } }),
    '/dates/calendar': wrap({ asyncComponent: () => import('./routes/Dates.svelte'), props: { view: 'calendar' } }),
    '/dates/lists': wrap({ asyncComponent: () => import('./routes/Dates.svelte'), props: { view: 'lists' } }),
    '/tasks': wrap({ asyncComponent: () => import('./routes/Tasks.svelte') }),
    // Before /tasks/:id, which would take "upcoming" for a project id.
    '/tasks/upcoming': wrap({ asyncComponent: () => import('./routes/TasksUpcoming.svelte') }),
    '/tasks/done': wrap({ asyncComponent: () => import('./routes/TasksDone.svelte') }),
    '/tasks/:id': wrap({ asyncComponent: () => import('./routes/TaskProject.svelte') }),
    '/help/:topic?': wrap({ asyncComponent: () => import('./routes/Help.svelte') }),
  };

  onMount(() => {
    fastTimer.init();
    settingsStore.init();
    attentionStore.init();
    visitStore.init();
    // Try an initial sync pull before offering the starter set, so a second
    // device picks up trackables/fields another device already created and
    // synced instead of being offered a duplicate set. If the server is there
    // but unreachable right now, wait for the first successful sync.
    (async () => {
      const outcome = await syncStore.init();
      if (outcome === 'failed') {
        syncStore.onceSynced(() => void starterStore.offer());
      } else {
        await starterStore.offer();
      }
    })();
  });

  /** On a project's page, Q adds to that project. */
  function projectFromRoute(): string | undefined {
    const m = window.location.hash.match(/^#\/tasks\/([^/?]+)$/);
    return m && !['upcoming', 'done', 'inbox'].includes(m[1]) ? m[1] : undefined;
  }

  // Keyboard shortcuts on a laptop (utils/keyboard.ts): a key to each page, W for a weigh-in, ? for the list.
  let shortcutsOpen = $state(false);
  async function onKey(e: KeyboardEvent) {
    if (shortcutsOpen && e.key !== '?') return;
    const action = shortcutFor({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target as HTMLElement | null, defaultPrevented: e.defaultPrevented });
    if (!action || document.querySelector('[role="dialog"]') && action.type !== 'help') return;
    e.preventDefault();
    if (action.type === 'go') push(action.href);
    else if (action.type === 'help') shortcutsOpen = !shortcutsOpen;
    else if (action.type === 'add-task') quickAdd.show(projectFromRoute());
    else if (action.type === 'search-tasks') {
      push('/tasks');
      await tick();
      taskSearch.focus();
    }
    else {
      const holder = await weighInTrackable(settingsStore.data);
      if (!holder) return;
      // Today hosts the entry sheet.
      push('/');
      await tick();
      void quickLog.log(holder);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- Phone: one column at phone width with tabs at the bottom. From lg (1024px) up:
     a sidebar and content that uses the width, up to 1400px. -->
<div class="flex flex-1 flex-col lg:flex-row">
  <BottomNav variant="side" />
  <div class="mx-auto flex w-full min-w-0 max-w-md flex-1 flex-col lg:max-w-[1400px] lg:px-6">
    <!-- Phone header: sync status, Help and Settings. On a laptop they live in the sidebar. -->
    <header class="flex items-center justify-end gap-2 px-3 pt-2 lg:hidden">
      <SyncStatus />
      <a
        href="/help"
        use:link
        class="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted"
        aria-label="Help"
      ><CircleHelp size={18} aria-hidden="true" /></a>
      <a
        href="/settings"
        use:link
        class="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted"
        aria-label="Settings"
      ><Settings size={18} aria-hidden="true" /></a>
    </header>
    <main class="flex flex-1 flex-col">
      <SectionTabs />
      <Router {routes} />
    </main>
    <BottomNav />
  </div>
</div>

<ZoneInfoSheet />
<QuickAddSheet />
<UndoToast />

<BottomSheet bind:open={shortcutsOpen}>
  <div class="space-y-3">
    <h2 class="text-lg font-semibold text-text">Keyboard shortcuts</h2>
    <ul class="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2" aria-label="Keyboard shortcuts">
      {#each SHORTCUTS as s (s.key)}
        <li class="flex items-center gap-3">
          <kbd class="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 font-mono text-xs text-text">{s.key.toUpperCase()}</kbd>
          <span class="text-text">{s.label}</span>
        </li>
      {/each}
    </ul>
    <p class="text-xs text-text-muted">Not while typing in a box. Esc closes a sheet.</p>
  </div>
</BottomSheet>
