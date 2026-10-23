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
  await page.getByRole('textbox', { name: 'What' }).fill('Beach trip');
  await page.getByLabel('Date', { exact: true }).fill(await dateFromToday(page, -3));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Past' }).getByRole('button', { name: /Beach trip/ })).toContainText('3 days ago');
});

test('dates due soon go under Needs attention, the next two weeks under Coming up, and the Dates page lists and calendars them', async ({ page }) => {
  await newFromTemplate(page, /Birthdays$/);
  for (const [name, days] of [['Mom', 3], ['Dad', 10]] as const) {
    await page.getByRole('button', { name: '+ Add person' }).click();
    await expect(page.getByLabel('Birthdate')).not.toHaveValue('');
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByLabel('Birthdate').fill(await dateFromToday(page, days, 60));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  }

  // Birthdays show in Needs attention 7 days ahead: Mom, not Dad. Dad is under Coming up instead.
  await page.goto('/#/trackables');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByRole('link', { name: /Mom/ })).toContainText('Turns 60 in 3 days');
  await expect(attention.getByRole('link', { name: /Dad/ })).toHaveCount(0);
  const comingUp = page.getByRole('region', { name: 'Coming up' });
  await expect(comingUp.getByRole('link', { name: /Dad: Turns 60/ })).toContainText('in 10 days');
  await expect(comingUp.getByRole('link', { name: /Mom/ })).toHaveCount(0);

  // The Dates page lists both birthdays soonest first (plus 1,000-day milestones later in the year).
  await comingUp.getByRole('link', { name: 'See all dates' }).click();
  await expect(page.getByRole('heading', { name: 'Dates', level: 1 })).toBeVisible();
  const birthdays = await page.getByRole('link', { name: /turns 60/ }).allTextContents();
  expect(birthdays.map((n) => (n.includes('Mom') ? 'Mom' : 'Dad'))).toEqual(['Mom', 'Dad']);
  await expect(page.getByRole('link', { name: /22,000 days old/ }).first()).toBeVisible();

  // The calendar marks Dad's day; tapping it lists him.
  await page.getByRole('button', { name: 'Calendar' }).click();
  const dadDay = await page.evaluate(() => {
    const t = new Date();
    t.setDate(t.getDate() + 10);
    return { label: t.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), nextMonth: t.getMonth() !== new Date().getMonth() };
  });
  if (dadDay.nextMonth) await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: `${dadDay.label}, 1 date` }).click();
  await expect(page.getByRole('region', { name: 'Selected day' }).getByRole('link', { name: /Dad/ })).toBeVisible();
});

test('the ? on the Dates and Sync pages opens their Help topics', async ({ page }) => {
  await page.goto('/#/dates');
  await page.getByRole('link', { name: 'Help: dates' }).click();
  await expect(page).toHaveURL(/#\/help\/dates$/);
  await expect(page.getByRole('heading', { name: 'Dates: birthdays, holidays and countdowns', level: 2 })).toBeInViewport();

  await page.goto('/#/sync');
  await page.getByRole('link', { name: 'Help: the Sync page' }).click();
  await expect(page).toHaveURL(/#\/help\/sync-page$/);
  await expect(page.getByRole('heading', { name: 'Your devices, checking sync and signing out', level: 2 })).toBeInViewport();
});
