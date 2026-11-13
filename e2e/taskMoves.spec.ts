import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSync, noServer, watchForProblems } from './helpers';

// Moving tasks in one tap (ARCHITECTURE.md 3.77): a task's quick menu from a
// right-click or a long press, with its sections to move it to, Open, Date,
// Duplicate and Delete; and several tasks picked with Ctrl+click and dragged
// as one. Fictional data.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockSync(page, noServer);
});

async function newProject(page: Page, name: string, sections: string) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: '+ Project' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('textbox', { name: 'Name' }).fill(name);
  await sheet.getByRole('combobox', { name: 'Sections' }).selectOption({ label: sections });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function addTask(page: Page, section: string, name: string) {
  const box = page.getByRole('textbox', { name: `Add a task to ${section}` });
  await box.fill(name);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

const section = (page: Page, name: string) => page.getByRole('region', { name });
const rows = (page: Page, name: string) => section(page, name).getByRole('list').first().getByRole('listitem');

/** A finger held on `target` for `ms`, through the browser's own touch input. */
async function hold(page: Page, target: Locator, ms = 700) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a right-click opens a task quick menu: move it to a section with Undo, duplicate it, delete it', async ({ page }) => {
  const problems = watchForProblems(page);
  await newProject(page, 'Errands', 'To do / Doing / Waiting');
  await addTask(page, 'To do', 'Post the parcel');
  await addTask(page, 'To do', 'Return the library books');

  await rows(page, 'To do').filter({ hasText: 'Post the parcel' }).click({ button: 'right' });
  const menu = page.getByRole('dialog');
  await expect(menu.getByRole('heading', { name: 'Post the parcel' })).toBeVisible();
  const moveTo = menu.getByRole('region', { name: 'Move to' });
  await expect(moveTo.getByRole('button', { name: 'To do' })).toHaveAttribute('aria-pressed', 'true');
  await moveTo.getByRole('button', { name: 'Waiting' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows(page, 'Waiting')).toHaveText([/Post the parcel/]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page, 'To do')).toHaveText([/Post the parcel/, /Return the library books/]);

  // Duplicate opens the copy; Delete asks first.
  await rows(page, 'To do').filter({ hasText: 'Return the library books' }).click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Task name' })).toHaveValue('Return the library books');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows(page, 'To do')).toHaveCount(3);
  await rows(page, 'To do').last().click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog').getByText("Delete this task? This can't be undone.")).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows(page, 'To do')).toHaveCount(2);

  // Set a date opens the date sheet.
  await rows(page, 'To do').first().click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Set a date' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Move Post the parcel' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Tomorrow' }).click();
  await expect(rows(page, 'To do').first().getByRole('button', { name: /^Due Tomorrow/ })).toBeVisible();
  expect(problems).toEqual([]);
});

test('on a phone a long press on a board card opens its menu, and a tap moves it to another column', async ({ page }) => {
  const problems = watchForProblems(page);
  await newProject(page, 'Garden', 'To do / Doing / Waiting');
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Board' }).click();
  await addTask(page, 'To do', 'Plant the bulbs');
  const card = page.getByRole('list', { name: 'Tasks in To do' }).getByRole('listitem').first();

  await hold(page, card.getByText('Plant the bulbs'));
  const menu = page.getByRole('dialog');
  await expect(menu.getByRole('heading', { name: 'Plant the bulbs' })).toBeVisible();
  // The press didn't also open the task's sheet.
  await expect(page.getByRole('textbox', { name: 'Task name' })).toHaveCount(0);
  await menu.getByRole('region', { name: 'Move to' }).getByRole('button', { name: 'Doing' }).click();
  await expect(page.getByRole('list', { name: 'Tasks in Doing' }).getByRole('listitem')).toHaveText([/Plant the bulbs/]);
  await expect(page.getByRole('list', { name: 'Tasks in To do' }).getByRole('listitem')).toHaveCount(0);

  // A short tap still opens the task.
  await page.getByRole('list', { name: 'Tasks in Doing' }).getByRole('button', { name: 'Plant the bulbs', exact: true }).tap();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Task name' })).toHaveValue('Plant the bulbs');
  expect(problems).toEqual([]);
});

test('on a laptop Ctrl+click picks several tasks, and dragging one moves them all', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, 'Attic', 'Now / Next / Later');
  for (const name of ['Sort the boxes', 'Fix the light', 'Seal the window', 'Lay insulation']) await addTask(page, 'Now', name);

  await section(page, 'Now').getByRole('button', { name: 'Fix the light', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await section(page, 'Now').getByRole('button', { name: 'Lay insulation', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
  // Selecting didn't open a task.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Drag one of them into the empty Later section: both go, in the order they showed.
  const later = (await section(page, 'Later').getByRole('list').first().boundingBox())!;
  const from = (await section(page, 'Now').getByText('Fix the light').boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + 20, from.y + ((later.y + 4 - from.y) * i) / 12);
  await page.mouse.up();
  await expect(rows(page, 'Later')).toHaveText([/Fix the light/, /Lay insulation/]);
  await expect(rows(page, 'Now')).toHaveText([/Sort the boxes/, /Seal the window/]);
  await expect(page.getByRole('status').filter({ hasText: 'selected' })).toHaveCount(0);

  // Esc clears a selection.
  await section(page, 'Now').getByRole('button', { name: 'Sort the boxes', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('status').filter({ hasText: '1 selected' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'selected' })).toHaveCount(0);
  expect(problems).toEqual([]);
});
