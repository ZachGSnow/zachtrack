import { describe, expect, it } from 'vitest';
import { allPresets, customPresetLabel, PRESETS } from '../src/lib/data/presets';
import { invalidReason } from '../src/lib/validate';

describe('custom fast presets', () => {
  it('are labelled like the built-in ones', () => {
    expect(customPresetLabel(15)).toBe('15:9');
    expect(customPresetLabel(19)).toBe('19:5');
    expect(customPresetLabel(36)).toBe('36 Hours');
    expect(customPresetLabel(16.5)).toBe('16.5 Hours');
  });

  it('go after the built-in fasts and before Count-Up', () => {
    const ids = allPresets([{ id: 'custom-a', label: '15:9', targetHours: 15 }]).map((p) => p.id);
    expect(ids).toHaveLength(PRESETS.length + 1);
    expect(ids.at(-1)).toBe('custom');
    expect(ids.at(-2)).toBe('custom-a');
    expect(allPresets(undefined)).toEqual(PRESETS);
  });

  it('are checked before they sync', () => {
    const settings = { id: 'app-settings', updatedAt: 1 };
    expect(invalidReason('settings', { ...settings, customFastPresets: [{ id: 'custom-a', label: '15:9', targetHours: 15 }] })).toBeNull();
    expect(invalidReason('settings', { ...settings, customFastPresets: [{ id: 'custom-a', label: '15:9', targetHours: 0 }] })).toMatch(/customFastPresets/);
    expect(invalidReason('settings', { ...settings, customFastPresets: 'x' })).toMatch(/customFastPresets/);
  });
});
