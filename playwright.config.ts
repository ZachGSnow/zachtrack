import { defineConfig, devices } from '@playwright/test';

// Browser tests against the production build, served by `wrangler pages dev`
// so the real service worker, public/_headers (CSP) and the sync Function are
// all in play. See e2e/README.md.
const PORT = 8789;

// The tests work out "today" and "yesterday" with Node's clock, and the browser
// runs in America/New_York (below), so the runner uses the same zone. Without
// this, CI (UTC) is a day ahead of the browser after 7 PM Eastern and the grid
// tests look for a day the app doesn't show yet. Same as vitest.config.ts.
process.env.TZ = 'America/New_York';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${PORT}`,
    // A zone with DST, like the unit tests.
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testMatch: '**/*.spec.ts' },
    // `npm run screenshots` only: writes docs/screenshots/*.png from sample data.
    { name: 'screenshots', use: { browserName: 'chromium' }, testMatch: '**/*.capture.ts' },
  ],
  webServer: {
    command: `npm run build && npx wrangler pages dev dist --port ${PORT} --ip 127.0.0.1 --compatibility-date=2026-10-01`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
