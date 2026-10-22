import { expect, test, type Page } from '@playwright/test';
import { importSampleData, mockSync, okSync } from './helpers';

// README screenshots: the real app, fictional sample data (sample-data.ts),
// phone size. Run with `npm run screenshots`; not part of `npm run e2e`.
// Sync answers "no changes" so the pill shows normal operation.
test.use({ serviceWorkers: 'block' });

const OUT = 'docs/screenshots';

async function shot(page: Page, name: string) {
  // Let charts finish their entry animation and the time labels settle.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('capture README screenshots', async ({ page }) => {
  await mockSync(page, okSync());
  await importSampleData(page);
  // The fasting timer reads the running fast at startup.
  await page.goto('/');
  await page.reload();

  await expect(page.getByText(/Synced/)).toBeVisible();
  await expect(page.getByRole('button', { name: /End|Stop/ }).first()).toBeVisible();
  await shot(page, 'fasting');

  await page.goto('/#/trackables');
  await expect(page.getByText('Body Measurements', { exact: true })).toBeVisible();
  await shot(page, 'trackables');

  await page.getByText('Body Measurements', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /Weight/ }).first()).toBeVisible();
  await shot(page, 'trackable-trends');

  await page.goto('/#/journey');
  await expect(page.getByText('Total fasts')).toBeVisible();
  // Three weeks of sample data: the 30-day range fills the table.
  await page.getByRole('button', { name: '30d', exact: true }).click();
  await shot(page, 'journey');
});
