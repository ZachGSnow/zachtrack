/**
 * Per-device UI preferences (view toggles, selected columns, etc.) persisted
 * in localStorage. Deliberately not synced: these are display choices, not
 * data, same reasoning as the sync-history pill (ARCHITECTURE.md 3.10).
 */

const PREFIX = 'zachtrack:';

export function loadPrefs<T extends object>(key: string, defaults: T): T {
  if (typeof localStorage === 'undefined') return { ...defaults };
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return { ...defaults };
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...defaults, ...(parsed as Partial<T>) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function savePrefs(key: string, value: object): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable -- preferences just won't persist.
  }
}

/** Guards a persisted enum-like value, falling back if it's stale or corrupt. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
