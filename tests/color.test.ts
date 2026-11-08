import { describe, expect, it } from 'vitest';
import { contrast, ensure, readableGraphic, readableText, TARGET } from '../src/lib/utils/color';
import { THEME } from '../src/lib/utils/theme';

describe('readable colours', () => {
  it('leaves a colour alone when it already has enough contrast', () => {
    expect(ensure('#22ff88', '#0b0f0e')).toBe('#22ff88');
    expect(ensure('#0b7a42', '#ffffff')).toBe('#0b7a42');
  });

  it('lightens a dark colour on a dark background until it reads, keeping its hue', () => {
    const fixed = ensure('#1d4ed8', THEME.dark.surface);
    expect(contrast(fixed, THEME.dark.surface)).toBeGreaterThanOrEqual(TARGET.text);
    expect(fixed).not.toBe('#1d4ed8');
    // Still a blue: more blue than red or green.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('darkens a light colour on a light background', () => {
    const fixed = ensure('#22ff88', THEME.light.surface);
    expect(contrast(fixed, THEME.light.surface)).toBeGreaterThanOrEqual(TARGET.text);
    expect(contrast(fixed, THEME.light.surface)).toBeLessThan(TARGET.text + 0.3);
  });

  it('accepts a lower target for graphics', () => {
    const text = readableText('#22ff88', 'light');
    const graphic = readableGraphic('#22ff88', 'light');
    expect(contrast(graphic, THEME.light.surface)).toBeGreaterThanOrEqual(TARGET.graphic);
    expect(contrast(graphic, THEME.light.surface)).toBeLessThan(contrast(text, THEME.light.surface));
  });

  it('returns the end of the range when nothing reaches the target', () => {
    expect(ensure('#000000', '#000000', 30)).toBe('#ffffff');
  });

  it("the themes' own text and brand colours pass on their surfaces", () => {
    for (const theme of ['light', 'dark'] as const) {
      const t = THEME[theme];
      expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.muted, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.brand, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.brandFg, t.brand)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.warn, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.danger, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
      expect(contrast(t.info, t.surface)).toBeGreaterThanOrEqual(TARGET.text);
    }
  });
});
