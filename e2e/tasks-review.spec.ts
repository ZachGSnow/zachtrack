import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, watchForProblems } from './helpers';

// Finding tasks and looking back (ARCHITECTURE.md 3.66): search on Tasks,
// the Done page, and task numbers in Insights and the weekly review.
// Fictional data.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockSync(page, noServer);
});

async function quickAdd(page: Page, ...lines: string[]) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: '+ Task' }).click();
  const box = page.getByRole('dialog').getByRole('textbox', { name: 'Task' });
  for (const line of lines) {
    await box.fill(line);
    await box.press('Enter');
    await expect(box).toHaveValue('');
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
}

test('search finds tasks by name and notes, and / jumps to it', async ({ page }) => {
  const problems = watchForProblems(page);
  await quickAdd(page, 'Buy: shelf liners', 'Buy: J hooks', 'Sweep the garage');
  // Notes on one of them.
  await page.getByRole('link', { name: /Inbox/ }).click();
  await page.getByRole('button', { name: /^Buy: J hooks/ }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Notes' }).fill('Heavy duty, for the ladder');
  await page.getByRole('dialog').getByRole('textbox', { name: 'Notes' }).blur();
  await page.keyboard.press('Escape');
  // Shortcuts wait while a sheet is on screen, including while it fades out.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/#/');
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await expect(search).toBeFocused();
  await search.fill('buy');
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('listitem')).toHaveCount(2);
  await search.fill('LADDER');
  await expect(results.getByRole('listitem')).toHaveText([/Buy: J hooks.*Inbox.*for the ladder/]);
  await search.fill('nothing like this');
  await expect(page.getByText('No tasks match')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('list', { name: 'Projects' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('Done lists what was completed by day, repeats included, and Insights and the weekly review count it', async ({ page }) => {
  const problems = watchForProblems(page);
  await quickAdd(page, 'Water the ferns every 3 days', 'Post the parcel today');
  await page.goto('/#/');
  const todayTasks = page.getByRole('region', { name: 'Tasks' });
  await todayTasks.getByRole('checkbox', { name: 'Complete Water the ferns' }).click();
  await expect(page.getByRole('status')).toContainText('Water the ferns done');
  await todayTasks.getByRole('checkbox', { name: 'Complete Post the parcel' }).click();
  await expect(page.getByRole('status')).toContainText('Completed Post the parcel');

  await page.goto('/#/tasks/done');
  const today = page.getByRole('region', { name: /^Today/ });
  await expect(today.getByRole('listitem')).toHaveCount(2);
  await expect(today.getByRole('listitem').filter({ hasText: 'Water the ferns' })).toContainText('on time');
  await expect(page.getByText('2 done, 1 of 1 repeats on time')).toBeVisible();
  // A row opens its task.
  await today.getByRole('button', { name: /Water the ferns/ }).click();
  await expect(page.getByRole('dialog').getByText(/Done 1 time/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/#/insights');
  const card = page.getByRole('region', { name: 'Tasks, last 30 days' });
  await expect(card).toContainText('2 done');
  await expect(card).toContainText('Repeating tasks: 1 of 1 done by their date');
  await expect(page.getByRole('region', { name: 'Year in review' })).toContainText('Tasks done');
  expect(problems).toEqual([]);
});
