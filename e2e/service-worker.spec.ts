import { expect, test, type Page } from '@playwright/test';
import { watchForProblems } from './helpers';

// The installed app's service worker answers navigations with the cached app
// shell so the app opens offline. Cloudflare Access can only run its login
// and callback on navigations that reach the network, so those paths and the
// `?reauth=` marker must never get the shell (ARCHITECTURE.md 4.9). These
// tests run the real generated service worker; vite-plugin-pwa upgrades must
// keep them passing.
test.use({ serviceWorkers: 'allow' });

async function installServiceWorker(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load isn't controlled yet; after a reload it is.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('the app shell opens offline once installed', async ({ page, context }) => {
  const problems = watchForProblems(page);
  await installServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('navigation').getByText('Fasting')).toBeVisible();
  await page.goto('/#/history');
  await expect(page.getByRole('navigation').getByText('History')).toBeVisible();
  await context.setOffline(false);
  // Offline sync attempts fail by design; only unexpected errors count.
  expect(problems.filter((p) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|NetworkError/i.test(p))).toEqual([]);
});

for (const path of ['/?reauth=1', '/cdn-cgi/access/callback?state=x', '/api/sync']) {
  test(`offline, ${path} is not answered with the cached app shell`, async ({ page, context }) => {
    await installServiceWorker(page);
    await context.setOffline(true);
    // If the service worker served the shell, this navigation would succeed.
    await expect(page.goto(path)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED|net::/);
    await context.setOffline(false);
  });
}

test('online, the re-login marker goes to the network and is stripped afterwards', async ({ page }) => {
  await installServiceWorker(page);
  const response = await page.goto('/?reauth=12345');
  expect(response?.fromServiceWorker()).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has('reauth')).toBe(false);
});

test('online, a normal navigation is served from the service worker cache', async ({ page }) => {
  await installServiceWorker(page);
  const response = await page.goto('/#/journey');
  expect(response?.fromServiceWorker()).toBe(true);
});
