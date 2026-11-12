import { expect, test } from '@playwright/test';
import { importSampleData, loginExpired, openSettings, mockSync, noServer, okSync, readStarterDefinitions, waitForStarterSet, watchForProblems } from './helpers';

// Screens and sync states on sample data. The service worker is blocked here
// so the sync responses can be faked; service-worker.spec.ts runs with it.
test.use({ serviceWorkers: 'block' });

test('a fresh install with no sync server is local-only and offers the starter trackables', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await expect(page.getByRole('button', { name: /Local only/ })).toBeVisible();
  for (const name of ['Activity', 'Body Measurements', 'Nutrition', 'Sleep', 'Vitals', 'Wellness Check-in']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('sample data imports through Settings and shows up on every screen', async ({ page }) => {
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
  await expect(page.getByText('Hit target')).toBeVisible();
  await expect(page.locator('main')).toContainText(/Hit target\s*\d+%\s*\d+ of 1\d/);

  // Data tab renders its table.
  await page.goto('/#/charting');
  await expect(page.getByRole('table').first()).toBeVisible();

  // Imported settings: height drives BMI, so it must have arrived.
  await page.goto('/#/trackables');
  await openSettings(page);
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
  await openSettings(page);
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
  await openSettings(page);
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
  // Sample meals are logged later in the day, so early in the morning there are none yet.
  await expect(card('Nutrition')).toContainText(/kcal today|Nothing today/);
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
  // The goal card and the Next tile both say it.
  await expect(page.getByText(/^Due (in \dd|tomorrow)$/).first()).toBeVisible();

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
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/?shortcut=log-weight#/', '/?shortcut=start-fast#/fasting', '/#/trackables', '/?shortcut=add-task#/tasks']);

  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/?shortcut=start-fast#/fasting');
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
  await openSettings(page);
  await page.getByLabel(/^Daily fast start/).fill('20:00');
  await page.getByLabel(/^Daily fast start/).blur();
  await page.goto('/#/fasting');
  await expect(page.getByText(/^(Next fast starts in .+|Your fast was due at .+ ago)$/)).toBeVisible();

  await importSampleData(page);
  await page.goto('/#/journey');
  await expect(page.getByText('Hit target')).toBeVisible();
  await expect(page.locator('main')).toContainText(/Hit target\s*\d+%\s*\d+ of \d+/);
  expect(problems).toEqual([]);
});

test('trackables can be pinned, archived and reordered, and lists filter by tag', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  const cards = page.locator('a[href^="#/trackables/"]');
  const card = (name: string) => page.getByRole('link', { name: new RegExp(name) });

  // Pin Vitals: it moves to the top whatever the sort.
  await card('Vitals').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Pin to the top of the list').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/#/trackables');
  await expect(cards.first()).toContainText('Vitals');
  await page.getByRole('button', { name: 'A-Z' }).click();
  await expect(cards.first()).toContainText('Vitals');

  // Reorder: move Sleep up one place in "My order".
  await page.getByRole('button', { name: 'Reorder' }).click();
  await expect(page.getByRole('button', { name: 'My order' })).toBeVisible();
  const before = await cards.allTextContents();
  const sleepAt = before.findIndex((text) => text.includes('Sleep'));
  await page.getByRole('button', { name: 'Move Sleep up' }).click();
  await expect.poll(async () => (await cards.allTextContents()).findIndex((text) => text.includes('Sleep'))).toBe(sleepAt - 1);

  // Archive Male Health: gone from the list, listed under archived, and restorable.
  await card('Male Health').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.goto('/#/trackables');
  await expect(card('Male Health')).toHaveCount(0);
  await page.getByRole('button', { name: /Show archived \(1\)/ }).click();
  await expect(card('Male Health')).toBeVisible();

  // Tag filters: Activity entries and History fasts.
  await card('Activity').click();
  await page.getByRole('button', { name: /^#gym/ }).click();
  const rows = page.getByRole('table').last().locator('tbody tr');
  await expect(rows.first()).toContainText('#gym');
  for (const text of await rows.allTextContents()) expect(text).toContain('#gym');
  await page.goto('/#/history');
  await page.getByRole('button', { name: /^#weekend/ }).click();
  const fastItems = page.getByRole('list', { name: 'Fasts' }).getByRole('listitem');
  await expect(fastItems.first()).toContainText('#weekend');
  for (const text of await fastItems.allTextContents()) expect(text).toContain('#weekend');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  expect(await fastItems.count()).toBeGreaterThan(await fastItems.filter({ hasText: '#weekend' }).count());
  expect(problems).toEqual([]);
});

test('on a laptop-width screen the sidebar replaces the tab bar and marks the current page', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  const sidebar = page.getByRole('navigation', { name: 'Main' }).filter({ hasText: 'ZachTrack' });
  await expect(sidebar).toBeVisible();
  // Four sections, each lit on any of its pages; the current page is marked under it.
  for (const [url, section, current] of [
    ['/#/', 'Today', null],
    ['/#/fasting', 'Fasting', 'Timer'],
    ['/#/journey', 'Fasting', 'Journey'],
    ['/#/history', 'Fasting', 'History'],
    ['/#/trackables', 'Trackables', 'List'],
    ['/#/dates', 'Trackables', 'Dates'],
    ['/#/insights', 'Insights', null],
  ] as const) {
    await page.goto(url);
    await expect(sidebar.locator('a.active')).toHaveText(new RegExp(section));
    if (current) await expect(sidebar.locator('a.current')).toHaveText(current);
    else await expect(sidebar.locator('a.current')).toHaveCount(0);
  }
  // The section tabs at the top of the page are for phones; the sidebar has them on a laptop.
  await page.goto('/#/journey');
  await expect(page.getByRole('navigation', { name: 'Fasting pages' })).toBeHidden();
  // Settings is in the sidebar too.
  await sidebar.getByRole('link', { name: 'Settings' }).click();
  await expect(sidebar.locator('a.active')).toHaveText(/Settings/);
  // Sheets open as centered dialogs and close with Escape.
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: '+ New' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Once its slide-in has finished, it sits inside the window, not against the bottom edge.
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return box.y > 0 && box.y + box.height < 900;
    })
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('on a phone five tabs mark the section, and tabs at the top switch its pages', async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs.getByRole('link')).toHaveText([/Today/, /Fasting/, /Trackables/, /Tasks/, /Insights/]);

  await page.goto('/#/journey');
  await expect(tabs.locator('a.active:visible')).toHaveText(/Fasting/);
  const fastingPages = page.getByRole('navigation', { name: 'Fasting pages' });
  await expect(fastingPages.locator('[aria-current="page"]')).toHaveText('Journey');
  await fastingPages.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  await expect(tabs.locator('a.active:visible')).toHaveText(/Fasting/);

  await tabs.getByRole('link', { name: /Trackables/ }).click();
  const trackablePages = page.getByRole('navigation', { name: 'Trackables pages' });
  await trackablePages.getByRole('link', { name: 'Dates' }).click();
  await expect(page.getByRole('heading', { name: 'Dates', level: 1 })).toBeVisible();
  await expect(tabs.locator('a.active:visible')).toHaveText(/Trackables/);

  // The Data tab's old address still opens Insights, and its tab lights up.
  await page.goto('/#/charting');
  await expect(tabs.locator('a.active:visible')).toHaveText(/Insights/);
});

test('the history grid shows a day and adds an entry for it', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Wellness Check-in/ }).click();

  const history = page.locator('div', { has: page.getByText('History', { exact: true }) }).last();
  // The six-month view always includes yesterday; each day is a button named by its date.
  await history.getByRole('button', { name: '6 mo' }).click();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const label = yesterday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  await page.getByRole('group', { name: 'Days' }).getByRole('button', { name: new RegExp(`^${label},`) }).click();
  await page.getByRole('button', { name: '+ Add an entry for this day' }).click();
  const pad = (n: number) => String(n).padStart(2, '0');
  await expect(page.getByLabel('Date & time')).toHaveValue(
    new RegExp(`^${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T12:00`),
  );

  // The Year view draws a whole year of cells without the old chart.
  await page.keyboard.press('Escape');
  await history.getByRole('button', { name: 'Year' }).click();
  await expect(page.getByRole('group', { name: 'Days' }).getByRole('button').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('a trackable with a goal gets a grid strip and a check button for today', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  const setGoal = async (name: string, type: string, value: string) => {
    await page.goto('/#/trackables');
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('combobox', { name: /^Goal/ }).selectOption(type);
    await page.locator('input[inputmode="decimal"]').last().fill(value);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  };
  await setGoal('Male Health', 'everyDays', '3');
  await setGoal('Body Measurements', 'everyDays', '1');
  await page.goto('/#/trackables');

  // Male Health has no fields: the button checks today, checks off again, and Undo restores it.
  const check = page.getByRole('button', { name: 'Check Male Health for today' });
  await check.click();
  await expect(page.getByRole('status')).toContainText('Logged Male Health');
  const uncheck = page.getByRole('button', { name: 'Uncheck Male Health for today' });
  await expect(uncheck).toHaveAttribute('aria-pressed', 'true');
  await uncheck.click();
  await expect(page.getByRole('status')).toContainText('Unchecked Male Health');
  await expect(check).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(uncheck).toBeVisible();

  // Each goal card has a strip of the habit grid; cards without a goal don't.
  const cardOf = (name: string) => page.locator('div.rounded-2xl', { has: page.getByRole('link', { name: new RegExp(name) }) });
  await expect(cardOf('Male Health').getByRole('group', { name: 'Days' })).toBeVisible();
  await expect(cardOf('Vitals').getByRole('group', { name: 'Days' })).toHaveCount(0);

  // A trackable with fields opens the log sheet instead.
  await page.getByRole('button', { name: 'Log Body Measurements' }).click();
  await expect(page.getByLabel('Date & time')).toBeVisible();
  expect(problems).toEqual([]);
});

test('on a laptop the trackable page puts its history beside the summary, and Trackables is a card grid', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  const cards = page.locator('a[href^="#/trackables/"]');
  await expect(cards.nth(1)).toBeVisible();
  const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThan(5); // side by side

  await page.getByRole('link', { name: /Wellness Check-in/ }).click();
  const summary = page.locator('main').getByText('Today', { exact: true });
  const history = page.locator('main').getByText('History', { exact: true });
  await expect(history).toBeVisible();
  expect((await history.boundingBox())!.x).toBeGreaterThan((await summary.boundingBox())!.x + 300);
  expect(problems).toEqual([]);
});

test('times-per-day counts taps on the card, and a day can be skipped from the grid', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Male Health/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('perDay');
  await page.getByRole('textbox', { name: 'Times per day' }).fill('2');
  await expect(page.getByRole('group', { name: 'Goal days' })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: 2 times a day')).toBeVisible();

  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Log one Male Health (0 of 2 today)' }).click();
  await page.getByRole('button', { name: 'Log one Male Health (1 of 2 today)' }).click();
  const done = page.getByRole('button', { name: 'Uncheck Male Health for today' });
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await done.click();
  await expect(page.getByRole('button', { name: 'Log one Male Health (1 of 2 today)' })).toBeVisible();

  // Skip today from the grid's day panel (the trackable was created today), then unskip it.
  await page.getByRole('link', { name: /Male Health/ }).click();
  const panel = page.locator('div.rounded-2xl', { has: page.getByText('History', { exact: true }) }).first();
  await panel.getByRole('button', { name: '6 mo' }).click();
  const label = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  await page.getByRole('group', { name: 'Days' }).getByRole('button', { name: new RegExp(`^${label},`) }).click();
  await page.getByRole('button', { name: 'Skip this day' }).click();
  await expect(page.getByRole('button', { name: 'Unskip this day' })).toBeVisible();
  // Today no longer needs its second time: the goal says so, and the streak won't break.
  await expect(page.getByText('Skipped today', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unskip this day' }).click();
  await expect(page.getByRole('button', { name: 'Skip this day' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a fast length of your own can be saved, started and removed', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/fasting');
  await page.getByRole('button', { name: '+ Your own' }).click();
  await page.getByRole('textbox', { name: 'Hours' }).fill('15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: '15:9', exact: true })).toBeVisible();
  await expect(page.getByText('Your own 15-hour fast')).toBeVisible();
  await page.getByRole('button', { name: '+ Your own' }).click();
  await page.getByRole('textbox', { name: 'Hours' }).fill('19');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Remove 19:5' }).click();
  await expect(page.getByRole('button', { name: '19:5', exact: true })).toHaveCount(0);

  // It's offered as the default method in Settings too.
  await page.goto('/#/trackables');
  await openSettings(page);
  await expect(page.getByLabel('Default fasting method').locator('option', { hasText: '15:9' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove 15:9' })).toBeVisible(); // listed under Your fast lengths
  await page.keyboard.press('Escape');

  await page.goto('/#/fasting');
  await page.getByRole('button', { name: '15:9', exact: true }).click();
  await page.getByRole('button', { name: 'Start Fast' }).click();
  await expect(page.getByText('of 15h goal')).toBeVisible();
  await expect(page.locator('p', { hasText: 'Change goal' })).toContainText('15:9');
  expect(problems).toEqual([]);
});

test('overdue goals are listed under Needs attention and counted on the Trackables tab', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  // Male Health has no sample entries, so an every-day goal is due whatever the time of day. (Wellness
  // Check-in was used before, but the sample logs it at 9 PM today, so after 9 PM it wasn't due.)
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Male Health/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('everyDays');
  await page.getByRole('textbox', { name: /Every how many days/ }).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.goto('/#/trackables');
  const panel = page.getByRole('region', { name: 'Needs attention' });
  await expect(panel).toContainText('Male Health');
  await expect(panel).toContainText(/Due now|Due today|Overdue by \dd/);
  const tab = page.getByRole('navigation', { name: 'Main' }).locator('a:visible', { hasText: 'Trackables' });
  await expect(tab.getByLabel(/needs? attention/)).toHaveText(/^[1-9]\d*$/);

  // Logging it clears the reminder.
  await panel.getByRole('link', { name: /Male Health/ }).click();
  await page.getByRole('button', { name: 'Log Entry' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/#/trackables');
  await expect(page.getByRole('region', { name: 'Needs attention' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a late scheduled fast puts a dot on the Fasting tab until a fast starts', async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/trackables');
  await openSettings(page);
  // Midnight has always passed, and this new install has no fast today.
  await page.getByLabel(/^Daily fast start/).fill('00:00');
  await page.getByLabel(/^Daily fast start/).blur();
  const fastingTab = page.getByRole('navigation', { name: 'Main' }).locator('a:visible', { hasText: 'Fasting' });
  await expect(fastingTab.getByLabel('fast is late')).toBeVisible();
  await page.goto('/#/fasting');
  await page.getByRole('button', { name: 'Start Fast' }).click();
  await expect(fastingTab.getByLabel('fast is late')).toHaveCount(0);
});

test("a trackable's page shows insights from its entries", async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Wellness Check-in/ }).click();
  const insights = page.getByRole('region', { name: 'Insights' });
  await expect(insights).toContainText(/Last 30 days: Logged on \d+ of \d+ days/);
  expect(problems).toEqual([]);
});

test('a trackable can start from a template, the list has a compact view, and data exports as CSV', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');

  // The Water template reuses the existing Water field and sets a daily total.
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('button', { name: /Vitamins$/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Vitamins');
  await expect(page.getByRole('combobox', { name: /^Goal/ })).toHaveValue('perDay');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: Once a day')).toBeVisible();

  // Compact hides the goal cards' grid strips.
  await page.goto('/#/trackables');
  const vitamins = page.locator('div.rounded-2xl', { has: page.getByRole('link', { name: /Vitamins/ }) });
  await expect(vitamins.getByRole('group', { name: 'Days' })).toBeVisible();
  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(vitamins.getByRole('group', { name: 'Days' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check Vitamins for today' })).toBeVisible();

  // CSV export from Settings > Your data.
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV for a spreadsheet' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^zachtrack-export-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(text.split('\r\n')[0]).toBe('\ufeffDate,Time,Trackable,Field,Value,Unit,Note,Tags');
  expect(text).toMatch(/,Body Measurements,Weight,\d+(\.\d)?,lb,/);
  expect(problems).toEqual([]);
});

test('Help opens from the header and from the question marks next to settings that need explaining', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.getByRole('link', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  const topics = page.getByRole('navigation', { name: 'Help topics' }).getByRole('link');
  await expect(topics).toHaveCount(15);
  for (const title of await topics.allTextContents()) {
    await expect(page.getByRole('heading', { name: title, level: 2 })).toHaveCount(1);
  }

  // The "?" next to Goal in a trackable's Edit sheet opens the Goals topic, scrolled into view.
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Wellness Check-in/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('link', { name: 'Help: goals' }).click();
  await expect(page).toHaveURL(/#\/help\/goals$/);
  await expect(page.getByRole('heading', { name: 'Goals', level: 2 })).toBeInViewport();
  expect(problems).toEqual([]);
});

test('Insights sums up fasting and each trackable above the compare table', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/insights');
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  const overview = page.getByRole('region', { name: 'Overview' });
  await expect(overview.getByRole('link', { name: /Fasting/ })).toContainText(/Goal met on \d+ of \d+ fasts in the last 30 days/);
  await expect(overview.getByRole('link', { name: /Body Measurements/ })).toContainText(/Logged on \d+ of \d+ days/);
  await expect(page.getByRole('region', { name: 'Patterns' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare', level: 2 })).toBeVisible();

  // Year in review: this year so far, with the sample's fasts and entries counted.
  const year = page.getByRole('region', { name: 'Year in review' });
  await expect(year).toContainText(`${new Date().getFullYear()} so far`);
  await expect(year).toContainText(/Fasts\s*1\d/);
  await expect(year).toContainText('Logged on the most days');

  await overview.getByRole('link', { name: /Body Measurements/ }).click();
  await expect(page).toHaveURL(/#\/trackables\//);
  expect(problems).toEqual([]);
});

test('Settings > Appearance switches the theme, which sticks on this device', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/settings');
  const html = page.locator('html');
  // System by default: no data-theme, so CSS follows prefers-color-scheme.
  await expect(html).not.toHaveAttribute('data-theme', /./);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f7f5');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0f0e');
  expect(problems).toEqual([]);
});
test('Today shows the fast, habits with a goal and recent logs, and checks a habit in one tap', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);

  // A habit: Male Health once a day.
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Male Health/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('perDay');
  await page.getByRole('textbox', { name: 'Times per day' }).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: Once a day')).toBeVisible();
  // A habit's page leads its tiles with how established it is.
  await expect(page.getByText('Strength', { exact: true })).toBeVisible();

  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  // The weekly review shows on Sundays and Mondays only.
  const weekday = new Date().getDay();
  await expect(page.getByRole('region', { name: 'Weekly review' })).toHaveCount(weekday === 0 || weekday === 1 ? 1 : 0);
  // The sample data has a 16:8 fast running past its goal.
  const fasting = page.getByRole('region', { name: 'Fasting' });
  await expect(fasting).toContainText('Fasting \u00b7 16:8');
  await expect(fasting.getByRole('progressbar', { name: 'Progress to goal' })).toBeVisible();
  // Past its goal or still on its way, depending on the hour the test runs.
  await expect(fasting).toContainText(/Goal reached at|left/);

  const habits = page.getByRole('region', { name: 'Habits' });
  await expect(habits).toContainText('Male Health');
  await expect(habits).toContainText('0 of 1 done');
  // Strength shows once there's something logged: here after the check below.
  await habits.getByRole('button', { name: 'Check Male Health for today' }).click();
  await expect(page.getByRole('status')).toContainText('Logged Male Health');
  await expect(habits).toContainText('1 of 1 done');
  await expect(habits.getByRole('button', { name: 'Uncheck Male Health for today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(habits).toContainText(/\d+% strong/);

  // Last 7 days: one cell per day; a tap on an earlier day fills it in, a second tap takes it back.
  const week = page.getByRole('region', { name: 'Last 7 days' });
  const row = week.getByRole('listitem').filter({ hasText: 'Male Health' });
  await expect(row.getByRole('group', { name: 'Days' }).getByRole('button')).toHaveCount(7);
  await expect(row.getByRole('button', { name: /1 entry, today$/ })).toBeVisible();
  await row.getByRole('button', { name: /nothing logged$/ }).first().click();
  await expect(page.getByRole('status')).toContainText(/^Logged Male Health for /);
  await expect(row.getByRole('button', { name: /1 entry/ })).toHaveCount(2);
  await row.getByRole('button', { name: /1 entry$/ }).first().click();
  await expect(page.getByRole('status')).toContainText(/^Unchecked Male Health for /);
  await expect(row.getByRole('button', { name: /1 entry/ })).toHaveCount(1);

  // The sample data weighs in most mornings: Body Measurements is under Log with its latest reading and 7-day average,
  // and a new entry starts from the last readings.
  const log = page.getByRole('region', { name: 'Log' });
  await expect(log).toContainText(/Body Measurements\s+\d+(\.\d+)? lb \u00b7 avg \d+(\.\d+)?/);
  await log.getByRole('button', { name: 'Log Body Measurements' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Weight (lb)' })).not.toHaveValue('');
  await expect(sheet).toContainText('Readings start from your last entry');
  await page.keyboard.press('Escape');

  // Its page says where the 7-day average is heading against the goal weight (176 lb in the sample settings).
  await log.getByRole('link', { name: /Body Measurements/ }).click();
  await expect(page.getByText(/^(At this rate, 176 lb|Moving away from your goal of 176 lb|Holding steady; your goal is 176 lb|At your goal of 176 lb)/)).toBeVisible();
  await expect(page.getByText(/^7-day average \d/)).toBeVisible();
  await page.goto('/#/');

  // No dates trackable in the sample data, so no Coming up.
  await expect(page.getByRole('region', { name: 'Coming up' })).toHaveCount(0);

  await fasting.getByRole('link', { name: 'Open timer' }).click();
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('Today starts a fast in one tap with today\'s method', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/');
  const fasting = page.getByRole('region', { name: 'Fasting' });
  await expect(fasting).toContainText('No fast running');
  await fasting.getByRole('button', { name: 'Start 16:8' }).click();
  await expect(fasting).toContainText('Fasting \u00b7 16:8');
  await expect(fasting.getByRole('progressbar', { name: 'Progress to goal' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Habits' })).toContainText('No goals yet');
  expect(problems).toEqual([]);
});

test('a fresh install offers the starter set and keeps only what you pick', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await page.goto('/#/trackables');
  const picker = page.getByRole('region', { name: 'What do you want to track?' });
  await expect(picker.getByRole('checkbox')).toHaveCount(8);
  for (const name of ['Body Measurements', 'Vitals', 'Nutrition', 'Wellness Check-in', 'Activity', 'Menstrual Cycle']) {
    await picker.getByRole('checkbox', { name: new RegExp(`^${name}`) }).uncheck();
  }
  await picker.getByRole('button', { name: 'Add 2 trackables' }).click();
  await expect(page.getByText('Sleep', { exact: true })).toBeVisible();
  await expect(page.getByText('Male Health', { exact: true })).toBeVisible();
  await expect(page.getByText('Body Measurements')).toHaveCount(0);
  await expect(picker).toHaveCount(0);
  // Only the fields those two need were made.
  const defs = await readStarterDefinitions(page);
  expect(defs.fields.map((f: { name: string }) => f.name).sort()).toEqual(['Sleep Hours', 'Sleep Quality']);
  expect(problems).toEqual([]);
});

test('Start empty leaves a fresh install without trackables and does not ask again', async ({ page }) => {
  await mockSync(page, noServer);
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Start empty' }).click();
  await expect(page.getByText('No trackables yet')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No trackables yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start empty' })).toHaveCount(0);
});

test('a trackable unlogged for six weeks is offered for archiving, and Not now snoozes the offer', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  // Nothing is quiet on day one.
  await expect(page.getByRole('region', { name: 'Quiet trackables' })).toHaveCount(0);

  // One Vitals entry, 60 days ago, and nothing since.
  await page.getByRole('link', { name: /Vitals/ }).click();
  await page.getByRole('button', { name: 'Log Entry' }).click();
  const when = new Date();
  when.setDate(when.getDate() - 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByLabel('Date & time').fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T09:00`);
  await page.getByRole('textbox', { name: 'Systolic BP' }).fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.goto('/#/trackables');
  const quiet = page.getByRole('region', { name: 'Quiet trackables' });
  await expect(quiet).toContainText('Vitals');
  // Sixty days ago at 9 AM reads as 59 or 60 days, depending on the hour the test runs.
  await expect(quiet).toContainText(/last (59d|60d|2mo|1mo \d+d) ago/);
  await quiet.getByRole('button', { name: 'Archive Vitals' }).click();
  await expect(quiet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Show archived \(1\)/ })).toBeVisible();

  // Another quiet one, snoozed with Not now, stays hidden after a reload.
  await page.getByRole('link', { name: /Sleep/ }).click();
  await page.getByRole('button', { name: 'Log Entry' }).click();
  await page.getByLabel('Date & time').fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T22:00`);
  await page.getByRole('textbox', { name: 'Sleep Hours (hrs)' }).fill('7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/#/trackables');
  await expect(quiet).toContainText('Sleep');
  await quiet.getByRole('button', { name: 'Not now' }).click();
  await expect(quiet).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Sleep', { exact: true })).toBeVisible();
  await expect(quiet).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('the weight chart draws its 7-day average, and changes are coloured toward the goal weight', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Body Measurements/ }).click();
  // The sample settings have a goal weight below the sample weights, so a change is good or bad, not neutral.
  await expect(page.getByText(/^7-day average \d/)).toHaveClass(/text-(brand|warn)/);
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(page.locator('[_echarts_instance_] svg').first()).toContainText('Weight 7-day avg');
  expect(problems).toEqual([]);
});

test('the Log weight shortcut opens the weigh-in sheet from the last reading, and Today suggests goals', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);

  await page.goto('/?shortcut=log-weight#/');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Body Measurements/ })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Weight (lb)' })).not.toHaveValue('');
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await page.keyboard.press('Escape');

  // The sample data logs Sleep every day without a goal: Today offers one, and one tap sets it.
  const suggested = page.getByRole('region', { name: 'Suggested goals' });
  // At most three at a time, the most regular first.
  await expect(suggested.getByRole('listitem')).toHaveCount(3);
  const sleep = suggested.getByRole('listitem', { name: 'Suggested goal for Sleep' });
  await expect(sleep).toContainText(/1[0-4] of the last 14 days/);
  await sleep.getByRole('button', { name: 'Every day' }).click();
  await expect(sleep).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Habits' }).getByRole('link', { name: /Sleep/ }).first()).toBeVisible();

  // Not now hides an offer on this device.
  const nutrition = suggested.getByRole('listitem', { name: 'Suggested goal for Nutrition' });
  await nutrition.getByRole('button', { name: /^Not now/ }).click();
  await expect(nutrition).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(nutrition).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a comparison can be hidden and brought back in Settings, and a trackable kept out of comparisons', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  // Plant a clear pattern: Male Health logged on the evenings of the heavier half of the sample weigh-ins,
  // so Body Measurements has "on days with" comparisons to hide. Written straight into the test browser's
  // database (fictional sample data only), then reloaded so the app reads it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('snowfast');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['trackableDefinitions', 'fieldDefinitions', 'trackableEntries'], 'readwrite');
          const t = tx.objectStore('trackableDefinitions').getAll();
          const f = tx.objectStore('fieldDefinitions').getAll();
          const e = tx.objectStore('trackableEntries').getAll();
          tx.oncomplete = () => {
            const body = t.result.find((x: { name: string }) => x.name === 'Body Measurements');
            const male = t.result.find((x: { name: string }) => x.name === 'Male Health');
            const weight = f.result.find((x: { name: string }) => x.name === 'Weight');
            const weighIns = (e.result as Array<{ trackableId: string; timestamp: number; values?: Record<string, number> }>)
              .filter((x) => x.trackableId === body.id && x.values?.[weight.id] != null)
              .sort((a, b) => b.values![weight.id] - a.values![weight.id]);
            const heavy = weighIns.slice(0, Math.ceil(weighIns.length / 2));
            const write = db.transaction('trackableEntries', 'readwrite');
            const store = write.objectStore('trackableEntries');
            heavy.forEach((w, i) => {
              const at = new Date(w.timestamp);
              at.setHours(7, 30, 0, 0);
              store.put({ id: `planted-${i}`, trackableId: male.id, timestamp: at.getTime(), createdAt: Date.now(), updatedAt: Date.now() });
            });
            write.oncomplete = () => {
              db.close();
              resolve();
            };
            write.onerror = () => reject(write.error);
          };
        };
      }),
  );
  await page.goto('/#/trackables');
  await page.reload();
  await page.getByRole('link', { name: /Body Measurements/ }).click();
  const insights = page.getByRole('region', { name: 'Insights' });
  const hide = insights.getByRole('button', { name: 'Hide this comparison' });
  await expect(hide.first()).toBeVisible();
  const before = await hide.count();
  const hidden = (await insights.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Hide this comparison' }) }).first().textContent())!.replace('Hide', '').trim();
  await hide.first().click();
  await expect(insights.getByText(hidden, { exact: false })).toHaveCount(0);

  await openSettings(page);
  const list = page.getByRole('list', { name: 'Hidden comparisons' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText(/^Body Measurements (on days with|the day after) Male Health/);
  await list.getByRole('button', { name: 'Show' }).click();
  await expect(list).toHaveCount(0);

  // Keep out of comparisons: none on its own page.
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Body Measurements/ }).click();
  await expect(hide).toHaveCount(before);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('checkbox', { name: /Keep out of comparisons/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(hide).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('Today says whether your data is safe, and an export from the card settles it', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/');
  const card = page.getByRole('region', { name: 'Your data' });
  // Local only and never exported: this device holds the only copy.
  await expect(card).toContainText('Your data needs a look');
  await expect(card).toContainText('Local only: this device holds the only copy');
  await expect(card).toContainText('Never exported from this device');
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Export a backup file' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await expect(card).toContainText('Your data is safe');
  await card.getByRole('button', { name: /Your data is safe/ }).click();
  await expect(card).toContainText('Exported here just now');
  expect(problems).toEqual([]);
});

test('after a long gap, Today says what happened since you were last here', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  // Pretend the app was last open three days ago.
  await page.evaluate(() => localStorage.setItem('zachtrack:last-active', JSON.stringify({ at: Date.now() - 3 * 24 * 3600_000 })));
  await page.goto('/#/');
  await page.reload();
  const away = page.getByRole('region', { name: 'Since you were last here' });
  await expect(away).toContainText('(3 days ago)');
  // The sample data's fasts reached their goals while "away".
  await expect(away).toContainText(/fast reached its goal/);
  await away.getByRole('button', { name: 'Dismiss' }).click();
  await expect(away).toHaveCount(0);
  // The next visit, moments later, has nothing to say.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(away).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a habit that slipped after going well gets a gentle card on Today, and Pause a week clears it', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  // Male Health logged every day from 30 to 8 days ago, then nothing: planted in the test browser's database.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('snowfast');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('trackableDefinitions', 'readonly').objectStore('trackableDefinitions').getAll();
          read.onsuccess = () => {
            const male = read.result.find((t: { name: string }) => t.name === 'Male Health');
            const tx = db.transaction('trackableEntries', 'readwrite');
            for (let n = 8; n <= 30; n++) {
              const d = new Date();
              d.setDate(d.getDate() - n);
              d.setHours(21, 0, 0, 0);
              tx.objectStore('trackableEntries').put({ id: `planted-${n}`, trackableId: male.id, timestamp: d.getTime(), createdAt: Date.now(), updatedAt: Date.now() });
            }
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole('link', { name: /Male Health/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('perDay');
  await page.getByRole('textbox', { name: 'Times per day' }).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: Once a day')).toBeVisible();

  await page.goto('/#/');
  const card = page.getByRole('region', { name: 'Male Health has slipped' });
  await expect(card).toContainText('after 23 of 23 days before');
  await card.getByRole('button', { name: 'Pause a week' }).click();
  await expect(card).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a measurement can read a smoothed trend and lead with it instead of the scale reading', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Body Measurements/ }).click();
  const trend = page.getByRole('group', { name: 'Trend' });
  await trend.getByRole('button', { name: 'Smoothed' }).click();
  await expect(page.getByText(/^Smoothed trend \d/)).toBeVisible();
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(page.locator('[_echarts_instance_] svg').first()).toContainText('Weight trend');

  await trend.getByRole('checkbox', { name: 'Lead with the trend' }).check();
  await expect(page.getByText('Weight trend', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Latest reading \d/)).toBeVisible();
  // A device preference: it sticks, and the lists follow it.
  await page.reload();
  await expect(page.getByText('Weight trend', { exact: true }).first()).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('region', { name: 'Log' })).toContainText(/Body Measurements\s+trend \d/);
  expect(problems).toEqual([]);
});

test('Today logs a reading or a rating without opening the sheet', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importSampleData(page);
  await page.goto('/#/');
  const log = page.getByRole('region', { name: 'Log' });
  const weight = log.getByRole('textbox', { name: 'Weight (lb)' });
  await expect(weight).toHaveAttribute('placeholder', /^Weight: last \d/);
  await weight.fill('181.4');
  await weight.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Logged Weight 181.4 lb' })).toBeVisible();
  await expect(weight).toHaveValue('');

  // The sample Wellness Check-in leads with Overall Mood, 1 to 5.
  const mood = log.getByRole('group', { name: 'Overall Mood, 1 to 5' });
  await mood.getByRole('button', { name: 'Overall Mood 4' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Logged Overall Mood 4' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('weigh-ins import from a scale app CSV, leaving out days already logged', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await openSettings(page);
  const section = page.getByRole('group', { name: 'Weigh-ins from a scale app' });
  // A Withings-style export in kg, three readings a few days back.
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const csv = `Date,Weight (kg),Fat mass (kg)\n${day(3)} 07:10:00,87.3,19.1\n${day(2)} 07:05:00,87.1,19.0\n${day(1)} 07:02:00,86.9,18.9\n`;
  await section.getByLabel('Scale CSV file').setInputFiles({ name: 'withings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(section).toContainText('3 new weigh-ins');
  await expect(section).toContainText('converted to lb');
  await section.getByRole('button', { name: 'Import 3 weigh-ins' }).click();
  await expect(section.getByRole('status')).toContainText('Imported 3 weigh-ins into Body Measurements.');

  // The same file again: nothing new.
  await section.getByLabel('Scale CSV file').setInputFiles({ name: 'withings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(section).toContainText('Nothing new');
  await page.goto('/#/trackables');
  await expect(page.getByRole('link', { name: /Body Measurements/ })).toContainText('191.6 lb');
  expect(problems).toEqual([]);
});

test('on a laptop, single keys move between pages, W opens a weigh-in and ? lists them', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  await page.keyboard.press('i');
  await expect.poll(() => new URL(page.url()).hash).toBe('#/insights');
  await page.keyboard.press('D');
  await expect.poll(() => new URL(page.url()).hash).toBe('#/dates');

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(sheet.getByRole('list', { name: 'Keyboard shortcuts' }).getByRole('listitem')).toHaveCount(12);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Typing in a box isn't a shortcut.
  await page.keyboard.press('s');
  await expect.poll(() => new URL(page.url()).hash).toBe('#/settings');
  const box = page.getByRole('textbox').first();
  await box.click();
  await page.keyboard.press('t');
  await expect.poll(() => new URL(page.url()).hash).toBe('#/settings');
  await box.blur();

  await page.keyboard.press('w');
  await expect.poll(() => new URL(page.url()).hash).toBe('#/');
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Body Measurements/ })).toBeVisible();
  expect(problems).toEqual([]);
});

test('past days fill in from one table on a trackable page', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Body Measurements/ }).first().click();
  await page.getByText('Fill in past days').click();
  const table = page.getByRole('table', { name: 'Fill in past days for Body Measurements' });
  // The header, then today, then yesterday and so on.
  await expect(table.getByRole('row')).toHaveCount(8);
  await table.getByRole('row').nth(2).getByRole('textbox', { name: /^Weight,/ }).fill('182.2');
  await table.getByRole('row').nth(3).getByRole('textbox', { name: /^Weight,/ }).fill('182.6');
  await table.getByRole('row').nth(4).getByRole('textbox', { name: /^Weight,/ }).fill('heavy');
  await expect(page.getByRole('alert')).toContainText("won't be saved");
  await page.getByRole('button', { name: 'Save 2 entries' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added 2 entries.' })).toBeVisible();
  await expect(table.getByRole('row').nth(2)).toContainText('1 already');
  await expect(table.getByRole('row').nth(3)).toContainText('1 already');
  expect(problems).toEqual([]);
});
