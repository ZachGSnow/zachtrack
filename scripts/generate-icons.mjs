// One-off/rerunnable script that rasterizes src/branding/icon.svg into the
// PNG sizes needed for PWA installability + Apple touch icon.
// Run with: node scripts/generate-icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const svgPath = path.join(root, 'src', 'branding', 'icon.svg');
const outDir = path.join(root, 'public');

mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath, 'utf-8');

const targets = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512 },
];

for (const { file, size } of targets) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const png = resvg.render().asPng();
  writeFileSync(path.join(outDir, file), png);
  console.log(`Wrote public/${file} (${size}x${size})`);
}
