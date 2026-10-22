import { expect, test } from '@playwright/test';
import { importSampleData, loginExpired, mockSync, noServer, okSync, readStarterDefinitions, waitForStarterSet, watchForProblems } from './helpers';

// Screens and sync states on sample data. The service worker is blocked here
// so the sync responses can be faked; service-worker.spec.ts runs with it.
test.use({ serviceWorkers: 'block' });

test('a fresh install with no sync server is local-only and creates the starter trackables', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await expect(page.getByRole('button', { name: /Local only/ })).toBeVisible();
  for (const name of ['Activity', 'Body Measurements', 'Nutrition', 'Sleep', 'Vitals', 'Wellness Check-in']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('sample data imports through the Profile sheet and shows up on every screen', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  const file = await importSampleData(page);
  expect(file.data.trackableEntries.length).toBeGreaterThan(100);

  // Trackables list: cards show recent activity instead of "No entries yet".
  await page.goto('/#/trackables');
  const nutritionCard = page.locator('a, button, div').filter({ hasText: /^Nutrition/ }).first();
  await expect(nutritionCard).not.toContainText('No entries yet');

  // A trackable's detail page: Trends table with Weight values, then the chart view.
  await page.getByText('Body Measurements', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /Weight/ }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^1(7|8)\d\.\d/ }).first()).toBeVisible();
  const chartToggle = page.getByRole('button', { name: 'Chart' }).first();
  if (await chartToggle.isVisible()) {
    await chartToggle.click();
    await expect(page.locator('[_echarts_instance_] svg').first()).toBeVisible();
  }

  // Journey: the imported fasts count.
  await page.goto('/#/journey');
  await expect(page.getByText('Total fasts')).toBeVisible();
  await expect(page.locator('main')).toContainText(/Total fasts\s*1\d/);

  // Data tab renders its table.
  await page.goto('/#/charting');
  await expect(page.getByRole('table').first()).toBeVisible();

  // Imported settings: height drives BMI, so it must have arrived.
  await page.getByRole('button', { name: 'Profile' }).waitFor({ state: 'detached' }).catch(() => {});
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByLabel('Height (in)')).toHaveValue('70');

  expect(problems).toEqual([]);
});

test('an expired login offers Log in again, which navigates past the app shell', async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.unroute('**/api/sync');
  await mockSync(page, loginExpired);
  await page.reload();

  await expect(page.getByRole('button', { name: /Login expired/ })).toBeVisible();
  const reauth = page.waitForRequest((req) => req.isNavigationRequest() && /[?&]reauth=\d+/.test(req.url()));
  await page.getByRole('button', { name: 'Log in again' }).click();
  await reauth;
  // After landing back, the marker is stripped so later reloads work offline again.
  await expect.poll(() => new URL(page.url()).searchParams.has('reauth')).toBe(false);
});

test('records the server refuses are listed by name with the reason', async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  const nutrition = (await readStarterDefinitions(page)).trackables.find((t) => t.name === 'Nutrition')!;
  await page.unroute('**/api/sync');
  await mockSync(page, okSync([{ recordType: 'trackableDefinitions', uuid: nutrition.id, reason: 'Invalid record: color must be a string' }]));
  await page.reload();

  const pill = page.getByRole('button', { name: /Synced/ });
  await expect(pill).toContainText('1');
  await pill.dblclick();
  await page.getByText(/1 not synced \(tap for why\)/).first().click({ force: true }).catch(() => {});
  await page.getByRole('button', { name: /No changes/ }).first().click();
  await expect(page.getByText('Trackable "Nutrition": Invalid record: color must be a string')).toBeVisible();
});
