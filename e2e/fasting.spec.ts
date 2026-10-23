import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, openSettings, waitForStarterSet } from './helpers';

// The Fasting tab: starting a fast you forgot to start, the timeline under
// the timer, changing the goal mid-fast, in-app milestones (no
// notifications), and the lighter ending with a summary.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
});

/** A datetime-local value `hours` before now, in the page's time zone. */
const hoursAgo = (page: Page, hours: number) =>
  page.evaluate((h) => {
    const d = new Date(Date.now() - h * 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, hours);

test('a fast started an hour ago shows its start, goal and next zone, and its goal can change', async ({ page }) => {
  await page.getByRole('button', { name: '16:8', exact: true }).click();
  await page.getByRole('button', { name: '1h ago' }).click();
  await page.getByRole('button', { name: 'Start Fast' }).click();

  await expect(page.getByText(/^01:00:\d\d$/)).toBeVisible();
  await expect(page.getByText(/^Started \d/)).toBeVisible();
  await expect(page.getByText(/^Goal .*, 15h left$/)).toBeVisible();
  await expect(page.getByText(/^Next: Post-Absorptive \(Catabolic\) State in 3h$/)).toBeVisible();

  await page.getByRole('button', { name: 'Change goal' }).click();
  await page.getByRole('button', { name: '18:6', exact: true }).click();
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByText(/^Goal .*, 17h left$/)).toBeVisible();
  await expect(page.getByText('of 18h goal')).toBeVisible();
  // Still the same fast: the clock didn't restart.
  await expect(page.getByText(/^01:00:\d\d$/)).toBeVisible();
});

test('a reached milestone shows in the app until dismissed, with a dot on the Fasting tab', async ({ page }) => {
  await page.getByRole('button', { name: 'Pick a time' }).click();
  await page.getByLabel('Fast started at').fill(await hoursAgo(page, 13));
  await page.getByRole('button', { name: 'Start Fast' }).click();

  const banner = page.getByRole('status').filter({ hasText: 'You reached Metabolic Shift & Lipolysis (12h)' });
  await expect(banner).toBeVisible();
  await expect(page.getByLabel('new fasting milestone').first()).toBeAttached();

  await page.getByRole('button', { name: 'Dismiss milestone' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByLabel('new fasting milestone')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('ending early says how short it was, and details are optional', async ({ page }) => {
  await page.getByRole('button', { name: '16:8', exact: true }).click();
  await page.getByRole('button', { name: '2h ago' }).click();
  await page.getByRole('button', { name: 'Start Fast' }).click();
  await page.getByRole('button', { name: 'End Fast' }).click();

  const summary = page.getByLabel('Fast summary');
  await expect(summary).toContainText('2h');
  await expect(summary).toContainText('14h short of 16h');
  await expect(page.getByRole('group', { name: 'How do you feel?' })).toHaveCount(0);
  await page.getByRole('button', { name: /Add details/ }).click();
  await page.getByRole('group', { name: 'Energy level?' }).getByRole('button', { name: '4' }).click();

  await page.getByRole('button', { name: 'Save & Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
});

test('a start time in the future is refused, and Settings has no notifications', async ({ page }) => {
  await page.getByRole('button', { name: 'Pick a time' }).click();
  await page.getByLabel('Fast started at').fill(await hoursAgo(page, -2));
  await page.getByRole('button', { name: 'Start Fast' }).click();
  await expect(page.getByText('The start time cannot be in the future.')).toBeVisible();

  await openSettings(page);
  await expect(page.getByText(/notification/i)).toHaveCount(0);
});
