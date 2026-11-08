// Keyboard shortcuts on a laptop (ARCHITECTURE.md 3.58): one key to each
// page, W to log a weigh-in and ? for the list. Single keys, like Gmail's,
// never while typing in a field or with Ctrl, Alt or Cmd held, so they can't
// clash with the browser's own shortcuts. Pure; tests/keyboard.test.ts.

export type ShortcutAction = { type: 'go'; href: string } | { type: 'log-weight' } | { type: 'help' };

export interface Shortcut {
  key: string;
  label: string;
  action: ShortcutAction;
}

export const SHORTCUTS: Shortcut[] = [
  { key: 't', label: 'Today', action: { type: 'go', href: '/' } },
  { key: 'f', label: 'Fasting timer', action: { type: 'go', href: '/fasting' } },
  { key: 'j', label: 'Journey', action: { type: 'go', href: '/journey' } },
  { key: 'h', label: 'Fasting history', action: { type: 'go', href: '/history' } },
  { key: 'l', label: 'Trackables list', action: { type: 'go', href: '/trackables' } },
  { key: 'd', label: 'Dates', action: { type: 'go', href: '/dates' } },
  { key: 'i', label: 'Insights', action: { type: 'go', href: '/insights' } },
  { key: 's', label: 'Settings', action: { type: 'go', href: '/settings' } },
  { key: 'w', label: 'Log a weigh-in', action: { type: 'log-weight' } },
  { key: '?', label: 'These shortcuts', action: { type: 'help' } },
];

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The element the key went to. */
  target?: { tagName?: string; isContentEditable?: boolean; type?: string } | null;
  defaultPrevented?: boolean;
}

/** The shortcut a key press means, or null: typing in a field, a modifier held, or not a shortcut. */
export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  const tag = t?.tagName?.toUpperCase();
  if (t?.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  // Inputs that take text; a checkbox or a button still lets shortcuts through.
  if (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes((t?.type ?? 'text').toLowerCase())) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return SHORTCUTS.find((s) => s.key === key)?.action ?? null;
}
