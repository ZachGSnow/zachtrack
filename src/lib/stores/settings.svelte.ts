import { DEFAULT_SETTINGS, getSettings, updateSettings, type SettingsRecord } from '../db';

class SettingsStore {
  data = $state<SettingsRecord>({ ...DEFAULT_SETTINGS, updatedAt: 0 });
  ready = $state(false);

  async init() {
    this.data = await getSettings();
    this.ready = true;
  }

  async update(patch: Partial<SettingsRecord>) {
    this.data = await updateSettings(patch);
  }
}

export const settingsStore = new SettingsStore();
