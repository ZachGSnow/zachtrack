import { loadPrefs, oneOf, savePrefs } from '../utils/prefs';
import { DEFAULT_MEASUREMENT_VIEW, type MeasurementView } from '../utils/trackableKinds';

/**
 * How measurements read their trend on this device (3.54): the 7-day average
 * or the smoothed trend, and whether the trend leads instead of the latest
 * scale reading. A display choice, so it stays per device like the others.
 */
const PREFS_KEY = 'measurement-view';

class MeasurementViewStore {
  view = $state<MeasurementView>({ ...DEFAULT_MEASUREMENT_VIEW });

  constructor() {
    const saved = loadPrefs<{ trend: unknown; leadWithTrend: unknown }>(PREFS_KEY, { ...DEFAULT_MEASUREMENT_VIEW });
    this.view = { trend: oneOf(saved.trend, ['average', 'smoothed'] as const, 'average'), leadWithTrend: saved.leadWithTrend === true };
  }

  set(patch: Partial<MeasurementView>) {
    this.view = { ...this.view, ...patch };
    savePrefs(PREFS_KEY, this.view);
  }
}

export const measurementView = new MeasurementViewStore();
