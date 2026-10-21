<script lang="ts">
  import Router from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { onMount } from 'svelte';
  import BottomNav from './lib/components/BottomNav.svelte';
  import Fasting from './routes/Fasting.svelte';
  import Trackables from './routes/Trackables.svelte';
  import History from './routes/History.svelte';
  import { fastTimer } from './lib/stores/fast.svelte';
  import { settingsStore } from './lib/stores/settings.svelte';
  import { syncStore } from './lib/stores/sync.svelte';
  import { seedDefaultTrackablesIfEmpty } from './lib/db';
  import ZoneInfoSheet from './lib/components/ZoneInfoSheet.svelte';
  import SyncStatus from './lib/components/SyncStatus.svelte';

  const routes = {
    '/': Fasting,
    '/trackables': Trackables,
    // Lazy-loaded: these pull in ECharts, so keep them out of the initial bundle.
    '/trackables/:id': wrap({ asyncComponent: () => import('./routes/TrackableDetail.svelte') }),
    '/journey': wrap({ asyncComponent: () => import('./routes/Journey.svelte') }),
    '/charting': wrap({ asyncComponent: () => import('./routes/Charting.svelte') }),
    '/history': History,
  };

  onMount(() => {
    fastTimer.init();
    settingsStore.init();
    // Try an initial sync pull before seeding defaults, so a second device
    // picks up trackables/fields another device already created and synced,
    // instead of generating its own duplicate default set. If the server is
    // there but unreachable right now, wait for the first successful sync.
    (async () => {
      const outcome = await syncStore.init();
      if (outcome === 'failed') {
        syncStore.onceSynced(() => void seedDefaultTrackablesIfEmpty());
      } else {
        await seedDefaultTrackablesIfEmpty();
      }
    })();
  });
</script>

<div class="mx-auto flex w-full max-w-md flex-1 flex-col">
  <div class="flex justify-end px-3 pt-2">
    <SyncStatus />
  </div>
  <main class="flex flex-1 flex-col">
    <Router {routes} />
  </main>
  <BottomNav />
</div>

<ZoneInfoSheet />
