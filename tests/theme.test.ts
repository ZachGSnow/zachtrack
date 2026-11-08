import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartColors, THEME } from '../src/lib/utils/theme';

// src/app.css is the source of truth for the tokens; utils/theme.ts repeats
// them for the charts. This keeps the copy honest. Vitest runs from the repo root.
const css = readFileSync(resolve('src/app.css'), 'utf8').toLowerCase();

describe('theme tokens', () => {
  it('every hex in utils/theme.ts is in app.css', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, hex] of Object.entries(THEME[theme])) {
        expect(css, `${theme}.${name} ${hex}`).toContain(hex.toLowerCase());
      }
    }
  });

  it('light-dark() pairs put the light value first and the dark value second', () => {
    const bg = css.match(/--color-bg:\s*light-dark\(([^,]+),\s*([^)]+)\)/);
    expect(bg?.[1].trim()).toBe(THEME.light.bg);
    expect(bg?.[2].trim()).toBe(THEME.dark.bg);
  });

  it('chart colours follow the theme', () => {
    expect(chartColors('dark').muted).toBe(THEME.dark.muted);
    expect(chartColors('light').line).toBe(THEME.light.border);
  });
});
