import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSync, noServer, watchForProblems } from './helpers';

// A project as a board (ARCHITECTURE.md 3.76): sections as columns, cards
// dragged within and between them, columns reordered, a column and a task
// added on the board, the choice kept per project. Fictional data.
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

async function addTask(page: Page, column: string, name: string) {
  const box = page.getByRole('textbox', { name: `Add a task to ${column}` });
  await box.fill(name);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

const board = (page: Page) => page.getByRole('region', { name: 'Board' });
const cards = (page: Page, column: string) => board(page).getByRole('list', { name: `Tasks in ${column}` });
const cardNames = (list: Locator) => list.getByRole('listitem').evaluateAll((els) => els.map((el) => el.querySelector('span.line-clamp-3')?.textContent?.trim()));
const columnNames = (page: Page) => board(page).locator(':scope > [data-column]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

/** Presses on `from` and moves the mouse in steps to the point (x, y) before letting go. */
async function drag(page: Page, from: Locator, x: number, y: number) {
  const a = (await from.boundingBox())!;
  const sx = a.x + Math.min(a.width / 2, 40);
  const sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(sx + ((x - sx) * i) / 12, sy + ((y - sy) * i) / 12);
  await page.mouse.up();
}

test('on a laptop a project shows as a board: cards and columns drag, and a section and task are added there', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await newProject(page, 'Kitchen', 'To do / Doing / Waiting');
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Board' }).click();
  await expect(board(page)).toBeVisible();
  await expect.poll(() => columnNames(page)).toEqual(['To do', 'Doing', 'Waiting']);

  for (const name of ['Fix the tap', 'Seal the counter', 'New cabinet doors']) await addTask(page, 'To do', name);
  await addTask(page, 'Waiting', 'Plumber quote tomorrow');
  await expect.poll(() => cardNames(cards(page, 'To do'))).toEqual(['Fix the tap', 'Seal the counter', 'New cabinet doors']);
  // The date typed at the end became the card's date.
  await expect(cards(page, 'Waiting').getByRole('button', { name: /^Due Tomorrow/ })).toBeVisible();

  // The mouse drags a card from anywhere on it into the empty Doing column.
  const doing = (await cards(page, 'Doing').boundingBox())!;
  await drag(page, cards(page, 'To do').getByText('Seal the counter'), doing.x + doing.width / 2, doing.y + 10);
  await expect.poll(() => cardNames(cards(page, 'Doing'))).toEqual(['Seal the counter']);
  await expect.poll(() => cardNames(cards(page, 'To do'))).toEqual(['Fix the tap', 'New cabinet doors']);
  // A plain click on a card still opens it.
  await cards(page, 'Doing').getByRole('button', { name: 'Seal the counter', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Task name' })).toHaveValue('Seal the counter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Within a column, the keyboard moves a card by its handle.
  await page.getByRole('button', { name: /^Drag New cabinet doors/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => cardNames(cards(page, 'To do'))).toEqual(['New cabinet doors', 'Fix the tap']);

  // Columns: Arrow Left on a column's handle, then a mouse drag of To do past Waiting.
  await page.getByRole('button', { name: /^Drag the Waiting column/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => columnNames(page)).toEqual(['To do', 'Waiting', 'Doing']);
  const last = (await board(page).locator(':scope > [data-column]').last().boundingBox())!;
  await drag(page, page.getByRole('button', { name: /^Drag the To do column/ }), last.x + last.width - 10, last.y + 20);
  await expect.poll(() => columnNames(page)).toEqual(['Waiting', 'Doing', 'To do']);

  // A section added at the end of the board, and a task in it.
  const newSection = page.getByRole('textbox', { name: 'Add a section' });
  await newSection.fill('Someday');
  await newSection.press('Enter');
  await expect.poll(() => columnNames(page)).toEqual(['Waiting', 'Doing', 'To do', 'Someday']);
  await addTask(page, 'Someday', 'Retile the floor');

  await page.screenshot({ path: test.info().outputPath('board-laptop.png') });

  // It lasts, and the board is this project's choice: the list shows the same order.
  await page.reload();
  await expect.poll(() => columnNames(page)).toEqual(['Waiting', 'Doing', 'To do', 'Someday']);
  await expect.poll(() => cardNames(cards(page, 'Doing'))).toEqual(['Seal the counter']);
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'List' }).click();
  await expect(board(page)).toHaveCount(0);
  const sectionNames = await page.locator('main section[aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(sectionNames).toEqual(['Waiting', 'Doing', 'To do', 'Someday']);
  expect(problems).toEqual([]);
});

test('on a phone the board shows a column at a time, with the column names to jump between them', async ({ page }) => {
  const problems = watchForProblems(page);
  await newProject(page, 'Garage', 'To do / Doing / Waiting');
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Board' }).click();
  await addTask(page, 'To do', 'Sweep the floor');
  await addTask(page, 'To do', 'Hang the bikes');

  const tabs = page.getByRole('navigation', { name: 'Columns' });
  await expect(tabs.getByRole('button')).toHaveText([/To do\s*2/, /Doing\s*0/, /Waiting\s*0/]);
  await expect(tabs.locator('[aria-current="true"]')).toHaveText(/To do/);
  // One column fills most of the screen.
  const width = page.viewportSize()!.width;
  const first = (await board(page).locator(':scope > [data-column]').first().boundingBox())!;
  expect(first.width).toBeGreaterThan(width * 0.7);
  await page.screenshot({ path: test.info().outputPath('board-phone.png') });

  await tabs.getByRole('button', { name: /Waiting/ }).click();
  await expect(tabs.locator('[aria-current="true"]')).toHaveText(/Waiting/);
  await expect(board(page).getByRole('textbox', { name: 'Add a task to Waiting' })).toBeInViewport();
  expect(problems).toEqual([]);
});

test('in the list a mouse drags a task from anywhere on its row, and a click still opens it', async ({ page }) => {
  await newProject(page, 'Porch', 'Now / Next / Later');
  for (const name of ['Sand the rail', 'Paint the rail']) await addTask(page, 'Now', name);
  const later = (await page.getByRole('region', { name: 'Later' }).getByRole('list').first().boundingBox())!;
  await drag(page, page.getByRole('region', { name: 'Now' }).getByText('Paint the rail'), later.x + 60, later.y + 4);
  await expect(page.getByRole('region', { name: 'Later' }).getByRole('listitem')).toHaveText([/Paint the rail/]);
  await page.getByRole('region', { name: 'Now' }).getByRole('button', { name: /^Sand the rail/ }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Task name' })).toHaveValue('Sand the rail');
});
