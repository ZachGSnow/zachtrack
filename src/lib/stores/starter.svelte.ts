import { db, seedStarterTrackables } from '../db';
import { loadPrefs, savePrefs } from '../utils/prefs';

/**
 * The starter set on a fresh install (ARCHITECTURE.md 3.44). Before v1.15.0
 * all eight starter trackables were created on first launch; now the
 * Trackables list offers them (StarterPicker.svelte) once the first sync has
 * settled, so a second device never gets a duplicate set and the owner
 * picks what they'll actually log. Declining is remembered per device.
 */
const PREFS_KEY = 'starter';

class StarterStore {
  /** The picker should show: no trackables on this device, and the offer wasn't declined. */
  pending = $state(false);
  busy = $state(false);

  async offer() {
    if (loadPrefs<{ declined: unknown }>(PREFS_KEY, { declined: false }).declined === true) return;
    this.pending = (await db.trackableDefinitions.count()) === 0;
  }

  async add(names: readonly string[]) {
    this.busy = true;
    try {
      await seedStarterTrackables(names);
    } finally {
      this.busy = false;
    }
    this.pending = false;
  }

  decline() {
    savePrefs(PREFS_KEY, { declined: true });
    this.pending = false;
  }
}

export const starterStore = new StarterStore();
