import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, openSettings, watchForProblems } from './helpers';

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

/** A YYYY-MM-DD date `days` from today in the page's time zone. */
const dayFromToday = (page: Page, days: number) =>
  page.evaluate((d) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }, days);

test('a repeating task moves to its next date when done, with Undo, Skip and its history, and shows on Today and Upcoming', async ({ page }) => {
  const problems = watchForProblems(page);
  await newProject(page, 'House', 'Now / Next / Later');
  await addTask(page, 'Now', 'Water the ferns');
  await addTask(page, 'Now', 'Book the plumber');

  // Every 3 days from yesterday, so it's overdue now; one subtask, done.
  await page.getByRole('button', { name: /Water the ferns/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Due date').fill(await dayFromToday(page, -1));
  await sheet.getByRole('combobox', { name: 'Repeat' }).selectOption({ label: 'Daily' });
  await sheet.getByRole('spinbutton', { name: 'Every how many' }).fill('3');
  await sheet.getByRole('spinbutton', { name: 'Every how many' }).press('Tab');
  await expect(sheet.getByText(/^Every 3 days\./)).toBeVisible();
  const sub = sheet.getByRole('textbox', { name: 'New subtask' });
  await sub.fill('Check the soil');
  await sub.press('Enter');
  await sheet.getByRole('checkbox', { name: 'Complete Check the soil' }).click();
  await page.keyboard.press('Escape');

  // The other task is due today. Both show on Today, oldest first, and on the tab badge.
  await page.getByRole('button', { name: /Book the plumber/ }).click();
  await sheet.getByLabel('Due date').fill(await dayFromToday(page, 0));
  await page.keyboard.press('Escape');
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs.getByRole('link', { name: /Tasks/ })).toContainText('2');
  await page.goto('/#/');
  const todayTasks = page.getByRole('region', { name: 'Tasks' });
  await expect(todayTasks.getByRole('listitem')).toHaveText([/Water the ferns.*Yesterday.*House \/ Now/, /Book the plumber.*Today/]);

  // Done a day late: the next date on the schedule after today (yesterday + 3 days), and the subtask reopens.
  await todayTasks.getByRole('checkbox', { name: 'Complete Water the ferns' }).click();
  await expect(page.getByRole('status')).toContainText(/Water the ferns done\. Next: /);
  await expect(todayTasks.getByRole('listitem')).toHaveText([/Book the plumber/]);
  await expect(tabs.getByRole('link', { name: /Tasks/ })).toContainText('1');
  // Undo puts the date and the subtask back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(todayTasks.getByRole('listitem')).toHaveCount(2);
  await todayTasks.getByRole('checkbox', { name: 'Complete Water the ferns' }).click();
  await expect(todayTasks.getByRole('listitem')).toHaveCount(1);

  await page.goto('/#/tasks/upcoming');
  const row = page.getByRole('listitem').filter({ hasText: 'Water the ferns' });
  await expect(row).toContainText('0/1 subtasks');
  await row.getByRole('button', { name: /Water the ferns/ }).click();
  await expect(sheet.getByText(/Done 1 time, last on/)).toBeVisible();
  const due = await sheet.getByLabel('Due date').inputValue();
  expect(due).toBe(await dayFromToday(page, 2));

  // Skip moves it on again without counting as done.
  await sheet.getByRole('button', { name: 'Skip this one' }).click();
  await expect(sheet.getByLabel('Due date')).toHaveValue(await dayFromToday(page, 5));
  await expect(sheet.getByText(/Done 1 time/)).toBeVisible();

  // Clearing the due date clears the repeat too.
  await sheet.getByRole('button', { name: 'Clear due date' }).click();
  await expect(sheet.getByText('Set a due date to make it repeat.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('tasks come in from an export file, with a repeating task and its history, and importing again adds nothing', async ({ page }) => {
  const problems = watchForProblems(page);
  const T = Date.UTC(2026, 9, 1);
  const file = {
    format: 'zachtrack-export',
    version: 1,
    exportedAt: new Date(T).toISOString(),
    data: {
      fasts: [],
      fieldDefinitions: [],
      trackableDefinitions: [],
      trackableEntries: [],
      taskProjects: [
        { id: 'p-routines', name: 'Routines', icon: 'R', color: '#a855f7', sections: [{ id: 's-seasonal', name: 'Seasonal' }], createdAt: T, updatedAt: T },
      ],
      tasks: [
        { id: 't-filter', name: 'Swap the furnace filter', projectId: 'p-routines', sectionId: 's-seasonal', dueOn: '2030-03-01', repeat: { type: 'months', every: 3, day: 1 }, sortOrder: 0, createdAt: T, updatedAt: T },
        { id: 't-buy', name: 'Buy filters', parentId: 't-filter', sortOrder: 0, createdAt: T, updatedAt: T },
      ],
      taskCompletions: [{ id: 'c-1', taskId: 't-filter', completedAt: T, dueOn: '2029-12-01', nextDueOn: '2030-03-01', createdAt: T, updatedAt: T }],
      settings: null,
    },
  };
  const choose = () =>
    page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'tasks.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

  await page.goto('/#/');
  await openSettings(page);
  await choose();
  await expect(page.getByText(/4 new records to add/)).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/^Imported: 4 added/)).toBeVisible();

  await page.goto('/#/tasks');
  await page.getByRole('link', { name: /Routines/ }).click();
  const row = page.getByRole('region', { name: 'Seasonal' }).getByRole('listitem');
  await expect(row).toContainText('0/1 subtasks');
  await row.getByRole('button', { name: /Swap the furnace filter/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Every 3 months on the 1st.', { exact: false })).toBeVisible();
  await expect(sheet.getByText(/Done 1 time/)).toBeVisible();
  await page.keyboard.press('Escape');

  // The same file again: everything is already here.
  await openSettings(page);
  await choose();
  await expect(page.getByText('4 records already here with the same or a newer version, left alone')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing to import' })).toBeDisabled();
  expect(problems).toEqual([]);
});
