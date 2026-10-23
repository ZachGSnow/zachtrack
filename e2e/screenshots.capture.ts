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

  await expect(page.getByRole('button', { name: /Synced/ }).locator('visible=true')).toBeVisible();
  await expect(page.getByRole('button', { name: /End|Stop/ }).first()).toBeVisible();
  // Normal use, not a reminder: dismiss the milestone banner (and with it the tab's dot).
  const dismiss = page.getByRole('button', { name: 'Dismiss milestone' });
  if (await dismiss.isVisible()) await dismiss.click();
  await shot(page, 'fasting');

  await page.goto('/#/trackables');
  await expect(page.getByText('Body Measurements', { exact: true })).toBeVisible();
  await shot(page, 'trackables');

  await page.getByText('Body Measurements', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /Weight/ }).first()).toBeVisible();
  // The trends table is below the summary: scroll to it.
  await page.getByText('Trends', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'trackable-trends');

  await page.goto('/#/journey');
  await expect(page.getByText('Goal streak', { exact: true })).toBeVisible();
  // Three weeks of sample data: the 30-day range fills the grid.
  await page.getByRole('button', { name: '30d', exact: true }).first().click();
  await shot(page, 'journey');

  await page.goto('/#/insights');
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await shot(page, 'insights');

  // Dates: fictional birthdays and anniversaries, and the US holiday pack.
  const fromToday = (days: number, years: number) =>
    page.evaluate(
      ([d, y]) => {
        const t = new Date();
        t.setFullYear(t.getFullYear() - y);
        t.setDate(t.getDate() + d);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
      },
      [days, years],
    );
  for (const template of [/US holidays$/, /Birthdays$/]) {
    await page.goto('/#/trackables');
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByRole('button', { name: template }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: /^\+ Add/ })).toBeVisible();
  }
  for (const [name, days, years] of [
    ['Alex', 9, 34],
    ['Jordan', 23, 61],
    ['Sam', 40, 8],
  ] as const) {
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByLabel('Birthdate').fill(await fromToday(days, years));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  }
  await page.goto('/#/dates');
  await expect(page.getByRole('heading', { name: 'Dates', level: 1 })).toBeVisible();
  await shot(page, 'dates');
});
