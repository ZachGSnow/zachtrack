import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Day math is timezone-sensitive, so tests run in a zone with DST changes.
process.env.TZ = 'America/New_York';

export default defineConfig({
  // Compiles runes in the stores (*.svelte.ts), so tests can drive them.
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
