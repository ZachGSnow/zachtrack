import { loadPrefs, savePrefs } from '../utils/prefs';

/**
 * When this device last had the app open, for "Since you were last here" on
 * Today (utils/sinceLastVisit.ts). `previous` is the time saved by the last
 * session, read once at startup; while the app is open the saved time keeps
 * up with the clock, so the next session reads when this one ended.
 */
const PREFS_KEY = 'last-active';

class VisitStore {
  /** When the app was last open before this session, or undefined on a first visit. */
  previous = $state<number | undefined>(undefined);
  /** Dismissed for this session. */
  dismissed = $state(false);

  private started = false;

  init() {
    if (this.started) return;
    this.started = true;
    const at = Number(loadPrefs<{ at: unknown }>(PREFS_KEY, { at: 0 }).at);
    this.previous = at > 0 ? at : undefined;
    this.touch();
    setInterval(() => this.touch(), 60_000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        // Coming back after a long time in the background is a new visit too.
        if (document.visibilityState === 'visible') {
          const last = Number(loadPrefs<{ at: unknown }>(PREFS_KEY, { at: 0 }).at);
          if (last > 0 && Date.now() - last > 12 * 3600_000) {
            this.previous = last;
            this.dismissed = false;
          }
        }
        this.touch();
      });
    }
  }

  private touch() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    savePrefs(PREFS_KEY, { at: Date.now() });
  }
}

export const visitStore = new VisitStore();
