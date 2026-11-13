import { expect, test, type Page } from '@playwright/test';
import { mockSync, noServer, openSettings, waitForStarterSet, watchForProblems } from './helpers';

// Splitting a trackable by field and merging one into another (ARCHITECTURE.md
// 3.72), and the At most N a week goal. Fictional data.
test.use({ serviceWorkers: 'block' });

const DAY = 86_400_000;

/** A trackable "Exercise" with a Run and a Swim field: three runs and two swims, each entry one or the other. */
async function importExercise(page: Page) {
  await waitForStarterSet(page);
  const now = Date.now();
  const created = now - 30 * DAY;
  const field = (id: string, name: string) => ({ id, name, kind: 'rating', ratingMin: 1, ratingMax: 5, createdAt: created, updatedAt: created });
  const entry = (id: string, daysAgo: number, fieldId: string, value: number) => ({
    id,
    trackableId: 'exercise',
    timestamp: now - daysAgo * DAY,
    values: { [fieldId]: value },
    createdAt: created,
    updatedAt: created,
  });
  const file = {
    format: 'zachtrack-export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    data: {
      fasts: [],
      fieldDefinitions: [field('f-run', 'Run'), field('f-swim', 'Swim')],
      trackableDefinitions: [
        { id: 'exercise', name: 'Exercise', icon: '\u{1F3C3}', color: '#38bdf8', fieldIds: ['f-run', 'f-swim'], goalType: 'perWeek', goalValue: 3, createdAt: created, updatedAt: created },
      ],
      trackableEntries: [entry('e1', 1, 'f-run', 4), entry('e2', 3, 'f-run', 3), entry('e3', 9, 'f-run', 5), entry('e4', 2, 'f-swim', 4), entry('e5', 12, 'f-swim', 2)],
    },
  };
  await openSettings(page);
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'exercise.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/^Imported: \d+ added/)).toBeVisible();
}

async function openEdit(page: Page, name: string) {
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
}

test('a trackable splits into one per field, keeping every entry and the goal, and Undo puts it back', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importExercise(page);

  await openEdit(page, 'Exercise');
  await page.getByRole('button', { name: 'Split by field' }).click();
  const panel = page.getByRole('region', { name: 'Split by field' });
  await expect(panel.getByRole('listitem')).toHaveText(['Run: 3 entries', 'Swim: 2 entries']);
  await expect(panel).toContainText('Exercise is then empty and is archived, not deleted.');
  await panel.getByRole('combobox', { name: /goal/ }).selectOption({ label: 'Run' });
  await panel.getByRole('button', { name: 'Split', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Trackables', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Undo' })).toContainText('Split Exercise into Run and Swim');
  await expect(page.getByRole('link', { name: /Exercise/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Run/ }).click();
  await expect(page.getByText('Goal: 3 times a week')).toBeVisible();
  await page.goto('/#/trackables');
  await page.getByRole('link', { name: /Swim/ }).click();
  await expect(page.getByRole('heading', { name: 'Swim', level: 1 })).toBeVisible();
  await expect(page.getByText(/^Goal:/)).toHaveCount(0);

  // Undo, within its six seconds.
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await page.goto('/#/trackables');
  await expect(page.getByRole('link', { name: /Exercise/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Swim/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Exercise/ }).click();
  await expect(page.getByText('Goal: 3 times a week')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a trackable merges into another, and an at-most goal counts each time this week', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockSync(page, noServer);
  await importExercise(page);
  await openEdit(page, 'Exercise');
  await page.getByRole('button', { name: 'Split by field' }).click();
  await page.getByRole('region', { name: 'Split by field' }).getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('link', { name: /Swim/ })).toBeVisible();

  // Merge Swim back into Run: every entry moves and Run gains the Swim field.
  await openEdit(page, 'Swim');
  await page.getByRole('button', { name: 'Merge into...' }).click();
  const merge = page.getByRole('region', { name: 'Merge into another trackable' });
  await merge.getByRole('combobox').selectOption({ label: '\u{1F3C3} Run' });
  await expect(merge).toContainText('2 entries move to Run, which gains Swim.');
  await merge.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Undo' })).toContainText('Merged Swim into Run');

  // At most 2 a week.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: /^Goal/ }).selectOption('maxPerWeek');
  await page.getByRole('textbox', { name: 'At most how many times a week' }).fill('2');
  await expect(page.getByLabel('Paused until (optional)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Goal: At most 2 times a week')).toBeVisible();
  await expect(page.getByText(/of at most 2 this week|this week, \d+ over the limit/).first()).toBeVisible();
  expect(problems).toEqual([]);
});
