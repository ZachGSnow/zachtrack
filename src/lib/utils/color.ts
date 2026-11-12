import { clampChroma, converter, formatHex, modeLrgb, modeOklab, modeOklch, modeRgb, useMode, wcagContrast } from 'culori/fn';
import { THEME, type ThemeName } from './theme';

// Readable colours. A trackable's colour is whatever hex the user picked, and
// it's drawn as text and icons on both themes; `ensure` moves a colour in
// OKLCH lightness (perceptually even, so its hue survives) until it reaches a
// contrast target against the background. Ported from the infographics
// studio's palette engine.

/** WCAG targets: body text 4.5:1 (AA); large text, icons and bars 3:1. */
export const TARGET = { text: 4.5, graphic: 3 } as const;

// Only the colour spaces used here (3.68): the full culori registers every
// space it knows, most of the library's size. Hex parses as rgb; contrast
// works in linear rgb; clamping and lightness in oklch (via oklab).
useMode(modeRgb);
useMode(modeLrgb);
useMode(modeOklab);
useMode(modeOklch);

const toOklch = converter('oklch');

export function contrast(a: string, b: string): number {
  return wcagContrast(a, b);
}

/**
 * `fg` as given when it already reaches `target` against `bg`; otherwise the
 * nearest lightness that does, away from the background (lighter on a dark
 * background, darker on a light one). The end of the range when nothing does.
 */
export function ensure(fg: string, bg: string, target: number = TARGET.text): string {
  if (contrast(fg, bg) >= target) return fg;
  const c = toOklch(fg);
  const b = toOklch(bg);
  if (!c || !b) return fg;
  const up = (b.l ?? 0) < 0.5;
  const limit = up ? 1 : 0;
  const at = (l: number) => formatHex(clampChroma({ ...c, l }, 'oklch'));
  let lo = c.l ?? 0.5;
  let hi = limit;
  let best = at(limit);
  if (contrast(best, bg) < target) return best;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = at(mid);
    if (contrast(candidate, bg) >= target) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/** A trackable's colour, readable as text on the theme's cards. */
export function readableText(color: string, theme: ThemeName): string {
  return ensure(color, THEME[theme].surface, TARGET.text);
}

/** A trackable's colour, readable as an icon, ring or bar on the theme's cards. */
export function readableGraphic(color: string, theme: ThemeName): string {
  return ensure(color, THEME[theme].surface, TARGET.graphic);
}
