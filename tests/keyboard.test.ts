import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutFor } from '../src/lib/utils/keyboard';

describe('keyboard shortcuts', () => {
  it('maps single keys to pages and actions, upper or lower case', () => {
    expect(shortcutFor({ key: 't' })).toEqual({ type: 'go', href: '/' });
    expect(shortcutFor({ key: 'I' })).toEqual({ type: 'go', href: '/insights' });
    expect(shortcutFor({ key: 'w' })).toEqual({ type: 'log-weight' });
    expect(shortcutFor({ key: '?' })).toEqual({ type: 'help' });
    expect(shortcutFor({ key: 'q' })).toEqual({ type: 'add-task' });
    expect(shortcutFor({ key: '/' })).toEqual({ type: 'search-tasks' });
    expect(shortcutFor({ key: 'x' })).toBeNull();
    expect(shortcutFor({ key: 'Enter' })).toBeNull();
  });

  it('stays out of the way while typing or with a modifier held', () => {
    expect(shortcutFor({ key: 't', target: { tagName: 'INPUT', type: 'text' } })).toBeNull();
    expect(shortcutFor({ key: 't', target: { tagName: 'input' } })).toBeNull();
    expect(shortcutFor({ key: 't', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(shortcutFor({ key: 't', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    expect(shortcutFor({ key: 't', ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: 't', metaKey: true })).toBeNull();
    expect(shortcutFor({ key: 't', defaultPrevented: true })).toBeNull();
    // A checkbox or a button doesn't take text.
    expect(shortcutFor({ key: 't', target: { tagName: 'INPUT', type: 'checkbox' } })).toEqual({ type: 'go', href: '/' });
    expect(shortcutFor({ key: 't', target: { tagName: 'BUTTON' } })).toEqual({ type: 'go', href: '/' });
  });

  it('has no key twice', () => {
    expect(new Set(SHORTCUTS.map((s) => s.key)).size).toBe(SHORTCUTS.length);
  });
});
