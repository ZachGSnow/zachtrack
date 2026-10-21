import { defineConfig } from 'vitest/config';

// Day math is timezone-sensitive, so tests run in a zone with DST changes.
process.env.TZ = 'America/New_York';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
