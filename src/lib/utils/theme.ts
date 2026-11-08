// The design tokens as hex, for code that can't read CSS: the charts (ECharts
// draws with literal colours) and the meta theme-color. src/app.css is the
// source of truth; tests/theme.test.ts fails if a value here isn't in it.

export type ThemeName = 'light' | 'dark';
/** What the user picked in Settings > Appearance; `system` follows the device. */
export type ThemeChoice = 'system' | ThemeName;

export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  brand: string;
  brandDim: string;
  brandFg: string;
  warn: string;
  danger: string;
  info: string;
}

export const THEME: Record<ThemeName, ThemeTokens> = {
  light: {
    bg: '#f4f7f5',
    surface: '#ffffff',
    surface2: '#e9efeb',
    border: '#d5ddd8',
    text: '#14201a',
    muted: '#5c7066',
    brand: '#0b7a42',
    brandDim: '#086232',
    brandFg: '#ffffff',
    warn: '#b45309',
    danger: '#dc2626',
    info: '#0e7490',
  },
  dark: {
    bg: '#0b0f0e',
    surface: '#121614',
    surface2: '#1a201d',
    border: '#262e2a',
    text: '#e6f2ec',
    muted: '#8ba398',
    brand: '#22ff88',
    brandDim: '#16a35c',
    brandFg: '#06140c',
    warn: '#fbbf24',
    danger: '#f87171',
    info: '#22d3ee',
  },
};

/** The colours a chart needs: text, axis lines and grid lines, plus the brand series. */
export function chartColors(theme: ThemeName) {
  const t = THEME[theme];
  return { text: t.text, muted: t.muted, line: t.border, grid: t.surface2, brand: t.brand, brandFg: t.brandFg, warn: t.warn, danger: t.danger };
}
