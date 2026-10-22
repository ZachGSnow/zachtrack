import { expect, test } from '@playwright/test';
import { mockSync, noServer, okSync, waitForStarterSet, type SyncMock } from './helpers';

// A fast started or ended on another device arrives through a sync pull. The
// Fasting tab must follow it without the app being reopened; ending it here
// a second time would otherwise overwrite the other device's end time.
test.use({ serviceWorkers: 'block' });

test('a fast started and then ended on another device shows up without a restart', async ({ page }) => {
  // Fresh install (local-only so the starter set is created), then switch to a server.
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.unroute('**/api/sync');

  const startTime = Date.now() - 3 * 3600000;
  const startDay = new Date(startTime).setHours(0, 0, 0, 0);
  const remoteFast = {
    uuid: 'fast-from-phone',
    startTime,
    startDay,
    method: 'preset',
    presetId: '16:8',
    presetLabel: '16:8',
    targetHours: 16,
    createdAt: startTime,
    updatedAt: startTime,
  };
  const pull = (fasts: unknown[], cursor: number): SyncMock => {
    const base = okSync();
    const body = base.body as { cursor: number; changes: { fasts: unknown[] } };
    return { status: 200, body: { ...body, cursor, changes: { ...body.changes, fasts } } };
  };

  let next: SyncMock = okSync();
  await mockSync(page, () => next);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();

  // The phone started a fast three hours ago; this device pulls it.
  next = pull([remoteFast], 10);
  await page.getByRole('button', { name: /Synced/ }).click();
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  await expect(page.getByText(/^0?3:0\d:\d\d$/)).toBeVisible();

  // The phone ended it; this device pulls the newer version.
  const endTime = Date.now();
  next = pull([{ ...remoteFast, endTime, updatedAt: endTime }], 11);
  // Two taps on the pill within 350 ms open the history instead of syncing.
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Synced/ }).click();
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End Fast' })).toHaveCount(0);
});

test('starting and ending a fast on this device still works', async ({ page }) => {
  await mockSync(page, noServer);
  await waitForStarterSet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Fast' }).click();
  await expect(page.getByRole('button', { name: 'End Fast' })).toBeVisible();
  await expect(page.getByText(/^00:00:\d\d$/)).toBeVisible();

  await page.getByRole('button', { name: 'End Fast' }).click();
  await page.getByRole('button', { name: 'Save & Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();

  // A reload agrees: the fast is finished, not running.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible();
});
