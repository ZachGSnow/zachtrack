import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, waitForStarterSet } from './helpers';

// Dates trackables: birthdays, the US holiday pack with rule-based holidays,
// and countdowns with renewals and past one-off dates.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
});

/** A YYYY-MM-DD date `days` from today, `years` back, in the page's time zone. */
const dateFromToday = (page: Page, days: number, years = 0) =>
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

async function newFromTemplate(page: Page, template: RegExp) {
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('button', { name: template }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test('a birthday shows the age it turns and a countdown, on its page and its card', async ({ page }) => {
  await newFromTemplate(page, /Birthdays$/);
  await expect(page.getByText('Birthdays', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Mom');
  await page.getByLabel('Birthdate').fill(await dateFromToday(page, 5, 60));
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const row = page.getByRole('list', { name: 'Upcoming' }).getByRole('button', { name: /Mom/ });
  await expect(row).toContainText('in 5 days');
  await expect(row).toContainText('turns 60');
  await expect(row).toContainText(/59 years 11 months \d+ days? old/);

  await page.goto('/#/trackables');
  await expect(page.getByText('Mom in 5 days')).toBeVisible();
});

test('the US holiday pack adds holidays that follow their rules', async ({ page }) => {
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('button', { name: /US holidays$/ }).click();
  await expect(page.getByText(/Saving adds 18 US holidays/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const upcoming = page.getByRole('list', { name: 'Upcoming' });
  await expect(upcoming.getByRole('button')).toHaveCount(18);
  // Thanksgiving falls on a Thursday in November, whichever year is next.
  await expect(upcoming.getByRole('button', { name: /Thanksgiving/ })).toContainText(/Thu, Nov (2[2-8])/);

  await upcoming.getByRole('button', { name: /Thanksgiving/ }).click();
  await expect(page.getByRole('combobox', { name: 'Repeats' })).toHaveValue('nthWeekday');
  await expect(page.getByText('4th Thursday of November')).toBeVisible();
});

test('a renewal repeats every few years, and a one-off date that passed moves to Past', async ({ page }) => {
  await newFromTemplate(page, /Countdowns$/);

  await page.getByRole('button', { name: '+ Add date' }).click();
  await page.getByRole('textbox', { name: 'What' }).fill('Passport');
  await page.getByRole('combobox', { name: 'Repeats' }).selectOption('everyYears');
  await page.getByRole('textbox', { name: 'Every how many years' }).fill('10');
  await page.getByLabel('Next due, or last done').fill(await dateFromToday(page, 40, 10));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Wait for the sheet to close before opening the next one.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Upcoming' }).getByRole('button', { name: /Passport/ })).toContainText('in 40 days');
  await expect(page.getByRole('list', { name: 'Upcoming' }).getByRole('button', { name: /Passport/ })).toContainText('every 10 years');

  await page.getByRole('button', { name: '+ Add date' }).click();
  // The sheet fills in its defaults once it has loaded; type after that.
  await expect(page.getByLabel('Date', { exact: true })).not.toHaveValue('');
  await page.getByRole('textbox', { name: 'What' }).fill('Beach trip');
  await page.getByLabel('Date', { exact: true }).fill(await dateFromToday(page, -3));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Past' }).getByRole('button', { name: /Beach trip/ })).toContainText('3 days ago');
});
