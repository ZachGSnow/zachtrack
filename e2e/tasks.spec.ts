import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, watchForProblems } from './helpers';

// The Tasks tab (ARCHITECTURE.md 3.60): a project with sections, tasks added
// in each section, a task's sheet with a due date and subtasks, completing
// with undo, and editing and deleting sections and projects. Fictional data.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockSync(page, noServer);
});

async function newProject(page: Page, name: string, sections: string) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: '+ New project' }).click();
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

test('a project with sections, tasks in each, and a task with a due date and subtasks', async ({ page }) => {
  const problems = watchForProblems(page);
  await newProject(page, 'Shed', 'Now / Next / Later');
  await expect(section(page, 'Now')).toBeVisible();
  await expect(section(page, 'Later')).toBeVisible();

  await addTask(page, 'Now', 'Fix the door');
  await addTask(page, 'Now', 'Oil the hinges');
  await addTask(page, 'Later', 'Paint the walls');
  await expect(section(page, 'Now').getByRole('listitem')).toHaveText([/Fix the door/, /Oil the hinges/]);
  await expect(page.getByText('3 open')).toBeVisible();

  // The sheet: a due date and two subtasks, one completed.
  await section(page, 'Now').getByRole('button', { name: /Fix the door/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Due date').fill('2030-01-15');
  const sub = sheet.getByRole('textbox', { name: 'New subtask' });
  await sub.fill('Buy a latch');
  await sub.press('Enter');
  await expect(sub).toHaveValue('');
  await sub.fill('Fit the latch');
  await sub.press('Enter');
  await sheet.getByRole('checkbox', { name: 'Complete Buy a latch' }).click();
  await expect(sheet.getByText('1 of 2 done')).toBeVisible();

  // A subtask opens in the same sheet, with the way back to its parent.
  await sheet.getByRole('button', { name: 'Fit the latch' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Task name' })).toHaveValue('Fit the latch');
  await sheet.getByRole('button', { name: /Subtask of Fix the door/ }).click();
  await expect(sheet.getByRole('textbox', { name: 'Task name' })).toHaveValue('Fix the door');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  const row = section(page, 'Now').getByRole('listitem').filter({ hasText: 'Fix the door' });
  await expect(row).toContainText('1/2 subtasks');
  await expect(row).toContainText(/Jan 15, 2030/);

  // Complete from the list, undo, complete again, and show it under completed.
  await page.getByRole('checkbox', { name: 'Complete Oil the hinges' }).click();
  await expect(page.getByRole('status')).toContainText('Completed Oil the hinges');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(section(page, 'Now').getByRole('listitem')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Complete Oil the hinges' }).click();
  await expect(section(page, 'Now').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show completed (1)' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen Oil the hinges' })).toBeVisible();

  // It all survives a reload, and the project list sums it up.
  await page.reload();
  await expect(section(page, 'Now').getByRole('listitem').filter({ hasText: 'Fix the door' })).toContainText('1/2 subtasks');
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('link', { name: /Shed/ })).toContainText('2 open');
  expect(problems).toEqual([]);
});

test('moving a task, renaming and removing sections, then deleting the project', async ({ page }) => {
  await newProject(page, 'Errands', 'To do / Doing / Waiting');
  await addTask(page, 'To do', 'Post the parcel');
  await addTask(page, 'Waiting', 'Collect the dry cleaning');

  // Move a task to another section from its sheet.
  await page.getByRole('button', { name: /Post the parcel/ }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Section' }).selectOption({ label: 'Doing' });
  await page.keyboard.press('Escape');
  await expect(section(page, 'Doing').getByRole('listitem')).toHaveText([/Post the parcel/]);

  // Rename one section, remove another: its task moves to the top of the project.
  await page.getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('textbox', { name: 'Section name' }).first().fill('Next up');
  await sheet.getByRole('button', { name: 'Remove Waiting' }).click();
  await expect(sheet.getByText(/move to the top of the project/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section(page, 'Next up')).toBeVisible();
  await expect(section(page, 'Waiting')).toHaveCount(0);
  await expect(section(page, 'Tasks').getByRole('listitem')).toHaveText([/Collect the dry cleaning/]);

  // Deleting the project asks first, then goes back to the list.
  await page.getByRole('button', { name: 'Edit' }).click();
  await sheet.getByRole('button', { name: 'Delete project' }).click();
  await expect(sheet).toContainText('Delete Errands and its 2 tasks');
  await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Errands/ })).toHaveCount(0);
});

test('the inbox holds tasks without a project, and K opens Tasks', async ({ page }) => {
  await page.goto('/#/');
  await page.keyboard.press('k');
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /Inbox/ }).click();
  const box = page.getByRole('textbox', { name: 'Add a task' });
  await box.fill('Call the dentist');
  await box.press('Enter');
  await expect(page.getByRole('button', { name: /Call the dentist/ })).toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('link', { name: /Inbox/ })).toContainText('1 open');
});
