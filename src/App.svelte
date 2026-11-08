<script lang="ts">
  import Router, { link } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { onMount } from 'svelte';
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
  import SyncStatus from './lib/components/SyncStatus.svelte';

  const routes = {
    '/': Today,
    // The timer, which was the home until Today arrived (v1.15.0).
    '/fasting': Fasting,
    '/trackables': Trackables,
    // Lazy-loaded: these pull in ECharts, so keep them out of the initial bundle.
    '/trackables/:id': wrap({ asyncComponent: () => import('./routes/TrackableDetail.svelte') }),
    '/journey': wrap({ asyncComponent: () => import('./routes/Journey.svelte') }),
    '/insights': wrap({ asyncComponent: () => import('./routes/Insights.svelte') }),
    // The Data tab's old address, so links and bookmarks to it still work.
    '/charting': wrap({ asyncComponent: () => import('./routes/Insights.svelte') }),
    '/history': History,
    '/settings': wrap({ asyncComponent: () => import('./routes/Settings.svelte') }),
    '/sync': wrap({ asyncComponent: () => import('./routes/Sync.svelte') }),
    '/dates': wrap({ asyncComponent: () => import('./routes/Dates.svelte') }),
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
</script>

<!-- Phone: one column at phone width with tabs at the bottom. From lg (1024px) up:
     a sidebar and content that uses the width, up to 1400px. -->
<div class="flex flex-1 flex-col lg:flex-row">
  <BottomNav variant="side" />
  <div class="mx-auto flex w-full max-w-md flex-1 flex-col lg:max-w-[1400px] lg:px-6">
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
