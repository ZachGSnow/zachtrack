import { loadPrefs, oneOf, savePrefs } from '../utils/prefs';
import { THEME, type ThemeChoice, type ThemeName } from '../utils/theme';

/**
 * Light or dark. The choice is per device (localStorage, like the other view
 * preferences): `system` follows prefers-color-scheme, and a fixed choice sets
 * data-theme on <html>, which src/app.css turns into `color-scheme`. The meta
 * theme-color follows so the Android status bar matches.
 */

const PREFS_KEY = 'theme';
export const THEME_CHOICES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

class ThemeStore {
  choice = $state<ThemeChoice>('system');
  /** What the device prefers right now. */
  system = $state<ThemeName>('dark');

  /** The theme in effect: the choice, or the device's when it's `system`. */
  get effective(): ThemeName {
    return this.choice === 'system' ? this.system : this.choice;
  }

  private media: MediaQueryList | undefined;

  /** Call before the app mounts, so a fixed choice applies before the first paint. */
  init() {
    const saved = loadPrefs<{ choice: unknown }>(PREFS_KEY, { choice: 'system' });
    this.choice = oneOf(saved.choice, ['system', 'light', 'dark'] as const, 'system');
    if (typeof matchMedia === 'function') {
      this.media ??= matchMedia('(prefers-color-scheme: light)');
      this.system = this.media.matches ? 'light' : 'dark';
      this.media.addEventListener('change', (e) => {
        this.system = e.matches ? 'light' : 'dark';
        this.apply();
      });
    }
    this.apply();
  }

  set(choice: ThemeChoice) {
    this.choice = choice;
    savePrefs(PREFS_KEY, { choice });
    this.apply();
  }

  private apply() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.choice;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME[this.effective].bg);
  }
}

export const themeStore = new ThemeStore();
