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

test("a field's chart line has the same color as its pill when an earlier field is hidden", async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByText('Body Measurements', { exact: true }).click();
  await page.getByRole('button', { name: 'Chart' }).first().click();

  // Weight (first field) is shown by default; swap it for Waist.
  await page.getByRole('button', { name: 'Weight', exact: true }).click();
  const waistPill = page.getByRole('button', { name: 'Waist', exact: true });
  await waistPill.click();

  const toRgb = (color: string) =>
    page.evaluate((c) => {
      const el = document.createElement('span');
      el.style.color = c;
      document.body.append(el);
      const rgb = getComputedStyle(el).color;
      el.remove();
      return rgb;
    }, color);
  const pillColor = await waistPill.evaluate((el) => getComputedStyle(el).color);
  const chart = page.locator('[_echarts_instance_] svg').first();
  await expect(chart).toBeVisible();
  await expect
    .poll(async () => {
      const strokes = await chart.locator('path[stroke-width="2"]').evaluateAll((els) => els.map((el) => el.getAttribute('stroke') ?? ''));
      return [...new Set(await Promise.all(strokes.map(toRgb)))];
    })
    .toEqual([pillColor]);
  expect(problems).toEqual([]);
});

test('a field can be renamed and given a new unit, and BMI follows the renamed weight field', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByText('Body Measurements', { exact: true }).click();
  await page.getByRole('button', { name: 'Table' }).first().click();
  await expect(page.getByRole('columnheader', { name: /BMI/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Weight', exact: true }).click();
  await page.getByLabel('Field name').fill('Body weight');
  await page.getByRole('button', { name: 'Save field' }).click();
  await page.getByRole('button', { name: 'Edit Waist', exact: true }).click();
  await page.getByLabel('Unit').fill('inch');
  await page.getByRole('button', { name: 'Save field' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('columnheader', { name: /Body weight/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /BMI/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Waist\s*inch/ }).first()).toBeVisible();

  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('combobox', { name: /^Weight field/ }).locator('option:checked')).toHaveText('Body weight (Body Measurements)');
  expect(problems).toEqual([]);
});

test('Body Measurements shows a Navy body-fat estimate right after BMI', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByText('Body Measurements', { exact: true }).click();
  await page.getByRole('button', { name: 'Table' }).first().click();

  const table = page.getByRole('table').first();
  await expect(table.locator('thead th[title="Body fat (Navy)"]')).toBeVisible();
  const { titles, values } = await table.evaluate((t) => {
    const titles = [...t.querySelectorAll('thead th[title]')].map((th) => th.getAttribute('title'));
    const col = titles.indexOf('Body fat (Navy)');
    const values = [...t.querySelectorAll('tbody tr')]
      .map((tr) => parseFloat(tr.querySelectorAll('td')[col]?.textContent ?? ''))
      .filter((v) => !Number.isNaN(v));
    return { titles, values };
  });
  expect(titles.indexOf('Body fat (Navy)')).toBe(titles.indexOf('BMI') + 1);
  // Sample data: waist about 36 in, neck 15.4 in, height 70 in -> about 20 %.
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v).toBeGreaterThan(17);
    expect(v).toBeLessThan(23);
  }

  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('combobox', { name: /^Formula/ }).locator('option:checked')).toHaveText('Male (waist, neck)');
  await expect(page.getByRole('combobox', { name: /^Neck field/ }).locator('option:checked')).toHaveText('Neck (Body Measurements)');
  expect(problems).toEqual([]);
});

test('each trackable leads with what matters for its kind, and the kind can be changed', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');

  // The link's name starts with the trackable's icon.
  const card = (name: string) => page.getByRole('link', { name: new RegExp(name) });
  // Weight is a reading, Calories add up per day, ratings are a daily check-in, no fields is time since.
  await expect(card('Body Measurements')).toContainText(/\d+(\.\d)? lb \u00b7 /);
  await expect(card('Nutrition')).toContainText(/kcal today/);
  await expect(card('Wellness Check-in')).toContainText(/today|streak/);
  await expect(card('Male Health')).toContainText('No entries yet');

  await card('Wellness Check-in').click();
  await expect(page.getByText('Current streak', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const summary = page.getByRole('combobox', { name: /^Summary/ });
  await expect(summary.locator('option:checked')).toHaveText('Auto: Check-in');
  await summary.selectOption('event');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Time since last', { exact: true })).toBeVisible();
  await expect(page.getByText('Usual gap', { exact: true })).toBeVisible();

  await page.goto('/#/trackables');
  await expect(card('Wellness Check-in')).toContainText(/ago/);
  expect(problems).toEqual([]);
});

test('a goal shows progress and due dates, and a trackable without fields logs in one tap with undo', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  const card = (name: string) => page.getByRole('link', { name: new RegExp(name) });

  // A weigh-in every 7 days: the sample data weighs in most mornings, so it isn't due yet.
  await card('Body Measurements').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('everyDays');
  await page.getByRole('textbox', { name: /Every how many days/ }).fill('7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: Every 7 days')).toBeVisible();
  await expect(page.getByText(/^Due (in \dd|tomorrow)$/)).toBeVisible();

  // A daily water total with a progress bar.
  await page.goto('/#/trackables');
  await card('Nutrition').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('dailyTotal');
  await page.getByRole('textbox', { name: /per day/ }).fill('3000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Goal progress' })).toBeVisible();
  await page.goto('/#/trackables');
  await expect(card('Nutrition')).toContainText(/\/ 3,000 kcal today/);

  // One tap on a trackable with no fields logs it; Undo takes it back.
  await expect(card('Male Health')).toContainText('No entries yet');
  await page.getByRole('button', { name: 'Log Male Health' }).click();
  await expect(page.getByRole('status')).toContainText('Logged Male Health');
  await expect(card('Male Health')).toContainText(/^.*0m ago/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card('Male Health')).toContainText('No entries yet');
  expect(problems).toEqual([]);
});

test('the home-screen shortcuts are in the manifest, and Start fast starts the default method once', async ({ page, request }) => {
  const problems = watchForProblems(page);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/?shortcut=start-fast#/', '/#/trackables', '/#/journey']);

  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/?shortcut=start-fast#/');
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  // The marker is removed, so reloading doesn't start another fast.
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a daily fast start time shows a countdown, and Journey shows how often fasts hit their target', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByLabel(/^Daily fast start/).fill('20:00');
  await page.getByLabel(/^Daily fast start/).blur();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/');
  await expect(page.getByText(/^(Next fast starts in .+|Your fast was due at .+ ago)$/)).toBeVisible();

  await importSampleData(page);
  await page.goto('/#/journey');
  await expect(page.getByText('Hit target')).toBeVisible();
  await expect(page.locator('main')).toContainText(/Hit target\s*\d+%\s*\d+ of \d+/);
  expect(problems).toEqual([]);
});
