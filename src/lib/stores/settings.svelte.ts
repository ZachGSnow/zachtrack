import { liveQuery, type Subscription } from 'dexie';
import { db, DEFAULT_SETTINGS, getSettings, updateSettings, type SettingsRecord } from '../db';

class SettingsStore {
  data = $state<SettingsRecord>({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  ready = $state(false);
  private subscription: Subscription | undefined;

  async init() {
    this.data = await getSettings();
    this.ready = true;
    // Settings also change without an edit on this device: a sync pull from
    // another device or an import writes them straight to IndexedDB. Follow
    // the table like every other screen does with liveQuery, so height (BMI),
    // goal weight and the rest update without restarting the app.
    this.subscription ??= liveQuery(() => db.settings.get('app-settings')).subscribe({
      next: (settings) => {
        if (settings) this.data = settings;
      },
    });
  }

  async update(patch: Partial<SettingsRecord>) {
    this.data = await updateSettings(patch);
  }
}

export const settingsStore = new SettingsStore();
