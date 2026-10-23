import { expect, test, type Page } from '@playwright/test';
import { okSync, openSettings, waitForStarterSet } from './helpers';

// After its first sync a device sends only what changed, the history says what
// was sent, and coming back online syncs on its own.
test.use({ serviceWorkers: 'block' });

interface SentBody {
  cursor: number;
  changes: { fieldDefinitions: unknown[]; trackableDefinitions: unknown[]; trackableEntries: Array<{ id: string }>; settings: unknown };
}

/** Answers like the real server: counts what was sent as applied, names it, and sends nothing back. */
async function recordSyncs(page: Page, network = { down: false }): Promise<SentBody[]> {
  const sent: SentBody[] = [];
  await page.route('**/api/sync', async (route) => {
    // Routes still answer while the context is offline, so fail the request by hand.
    if (network.down) return route.abort('internetdisconnected');
    const body = route.request().postDataJSON() as SentBody;
    sent.push(body);
    const base = okSync().body as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        cursor: sent.length,
        appliedCounts: { trackableEntries: body.changes.trackableEntries.length },
        applied: body.changes.trackableEntries.map((e) => ({ recordType: 'trackableEntries', uuid: e.id })),
      }),
    });
  });
  return sent;
}

test('an edit sends only that record, and the history names it', async ({ page }) => {
  const sent = await recordSyncs(page);
  await waitForStarterSet(page);
  // The starter set goes up once, after the first sync.
  await expect.poll(() => sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);
  const before = sent.length;

  await page.getByRole('button', { name: 'Log Male Health' }).click();
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(before);
  const last = sent[sent.length - 1];
  expect(last.changes.trackableEntries).toHaveLength(1);
  expect(last.changes.fieldDefinitions).toHaveLength(0);
  expect(last.changes.trackableDefinitions).toHaveLength(0);
  expect(last.changes.settings).toBeNull();

  await openSettings(page);
  await page.getByRole('button', { name: /Sent 1 entry/ }).first().click();
  await expect(page.getByText(/^Male Health -- /)).toBeVisible();
  await expect(page.getByText('Nothing waiting: the server has every change from this device.')).toBeVisible();
});

test('changes made offline show as waiting and go up when the device is back online', async ({ page, context }) => {
  const network = { down: false };
  const sent = await recordSyncs(page, network);
  await waitForStarterSet(page);
  await expect.poll(() => sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);

  network.down = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Log Male Health' }).click();
  await expect(page.getByRole('button', { name: /Offline/ }).locator('visible=true')).toContainText('1 waiting', { timeout: 10_000 });

  const before = sent.length;
  network.down = false;
  await context.setOffline(false); // fires "online", which syncs without a tap
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: /Synced/ }).locator('visible=true')).not.toContainText('waiting');
  expect(sent[sent.length - 1].changes.trackableEntries).toHaveLength(1);
});
