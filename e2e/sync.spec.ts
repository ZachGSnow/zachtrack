import { expect, test, type Page } from '@playwright/test';
import { okSync, openSettings, readStarterDefinitions, waitForStarterSet } from './helpers';

// After its first sync a device sends only what changed, the history says what
// was sent and received and from which device, coming back online syncs on its
// own, and the Sync page lists devices and the shared activity.
test.use({ serviceWorkers: 'block' });

interface SentBody {
  cursor: number;
  changes: { fieldDefinitions: unknown[]; trackableDefinitions: unknown[]; trackableEntries: Array<{ id: string }>; settings: unknown };
  device: { id: string; name: string; appVersion: string };
  check?: boolean;
}

interface FakeServer {
  sent: SentBody[];
  /** While true, sync requests fail as if offline (routes still answer while the context is offline). */
  down: boolean;
  /** Entries to hand the next sync, as if from another device. */
  incoming: Array<Record<string, unknown>>;
  /** Devices other than the one syncing. */
  others: Array<Record<string, unknown>>;
  /** What the server says it holds when a sync asks to check. */
  counts?: Record<string, number>;
  /** Answer every sync with this status instead (401: logged out). */
  status?: number;
}

/** Answers like the real server: counts what was sent as applied, names it, and sends back only `incoming`. */
async function fakeServer(page: Page): Promise<FakeServer> {
  const server: FakeServer = { sent: [], down: false, incoming: [], others: [] };
  await page.route('**/api/sync', async (route) => {
    if (server.down) return route.abort('internetdisconnected');
    if (server.status) return route.fulfill({ status: server.status, body: '' });
    const body = route.request().postDataJSON() as SentBody;
    server.sent.push(body);
    const base = okSync().body as { changes: Record<string, unknown> };
    const incoming = server.incoming;
    server.incoming = [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        cursor: server.sent.length,
        changes: { ...base.changes, trackableEntries: incoming },
        appliedCounts: { trackableEntries: body.changes.trackableEntries.length },
        applied: body.changes.trackableEntries.map((e) => ({ recordType: 'trackableEntries', uuid: e.id })),
        devices: [{ ...body.device, firstSeenAt: 1, lastSeenAt: Date.now() }, ...server.others],
        ...(body.check ? { counts: server.counts } : {}),
      }),
    });
  });
  return server;
}

const laptop = { id: 'dev-laptop', name: 'Laptop', appVersion: '1.0.0', firstSeenAt: 1, lastSeenAt: Date.now() - 3600_000 };

test('an edit sends only that record, and the history names it', async ({ page }) => {
  const { sent } = await fakeServer(page);
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
  const network = await fakeServer(page);
  const sent = network.sent;
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

test('the Sync page lists devices, flags an older version, names where a change came from, and shows the activity', async ({ page }) => {
  const server = await fakeServer(page);
  server.others = [laptop];
  await page.route('**/api/activity*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            id: 1,
            deviceId: 'dev-laptop',
            at: Date.now() - 60_000,
            counts: { trackableEntries: 2 },
            details: ['Entry -- Male Health', 'Entry -- Sleep'],
            rejectedCount: 0,
          },
        ],
        // Like the real list: every device that synced, this one included.
        devices: [{ ...server.sent[server.sent.length - 1]?.device, firstSeenAt: 1, lastSeenAt: Date.now() }, laptop],
        more: false,
      }),
    }),
  );
  await waitForStarterSet(page);
  await expect.poll(() => server.sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);
  const maleHealth = (await readStarterDefinitions(page)).trackables.find((t) => t.name === 'Male Health')!;

  // The laptop logged Male Health; this device receives it.
  const at = Date.now() - 120_000;
  server.incoming = [{ id: 'from-laptop', trackableId: maleHealth.id, timestamp: at, createdAt: at, updatedAt: at, updatedBy: 'dev-laptop' }];
  await page.goto('/#/sync');
  await expect(page.getByRole('heading', { name: 'Sync', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByRole('button', { name: /Received 1 entry/ }).first().click();
  await expect(page.getByText(/^Male Health -- .*\(Laptop\)$/)).toBeVisible();

  // Both devices are listed; the laptop's older version is flagged.
  const devices = page.getByRole('region', { name: 'Your devices' });
  await expect(devices.getByText('Laptop', { exact: true })).toBeVisible();
  await expect(devices).toContainText('older version: reopen the app on it to update');
  await expect(devices).toContainText('(this device)');

  // The shared activity, with names on tap.
  const activity = page.getByRole('region', { name: 'Activity on all devices' });
  await activity.getByRole('button', { name: /Laptop/ }).click();
  await expect(activity).toContainText('2 entries');
  await expect(activity.getByText('Entry -- Sleep')).toBeVisible();
});

test('renaming this device sends the new name with the next sync', async ({ page }) => {
  const server = await fakeServer(page);
  await waitForStarterSet(page);
  await page.goto('/#/sync');
  const name = page.getByLabel('Device name');
  await expect(name).not.toHaveValue('');
  await name.fill('Test phone');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect.poll(() => server.sent[server.sent.length - 1]?.device.name).toBe('Test phone');
  await expect(page.getByRole('region', { name: 'Your devices' })).toContainText('Test phone (this device)');
});

test("an edit replaced by another device's newer one is called out in the history", async ({ page, context }) => {
  const server = await fakeServer(page);
  await waitForStarterSet(page);
  await expect.poll(() => server.sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);
  server.others = [laptop];

  // Logged here while offline...
  server.down = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Log Male Health' }).click();
  await expect(page.getByRole('button', { name: /Offline/ }).locator('visible=true')).toContainText('1 waiting', { timeout: 10_000 });
  const local = await page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const open = indexedDB.open('snowfast');
        open.onsuccess = () => {
          const req = open.result.transaction('trackableEntries').objectStore('trackableEntries').getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result[0]);
          };
        };
      }),
  );

  // ...while the laptop edited the same entry later.
  const later = (local.updatedAt as number) + 60_000;
  server.incoming = [{ ...local, updatedAt: later, note: 'from the laptop', updatedBy: 'dev-laptop' }];
  server.down = false;
  await context.setOffline(false);
  await openSettings(page);
  await expect(page.getByText(/An edit here was replaced by a newer one/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Sent 1 entry/ }).first().click();
  await expect(page.getByText(/^Your edit to an entry: Male Health -- .* was replaced by Laptop's newer one$/)).toBeVisible();
});

test('Check sync compares counts, and Full resync starts over from the beginning', async ({ page }) => {
  const server = await fakeServer(page);
  await waitForStarterSet(page);
  await expect.poll(() => server.sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);
  const starter = await readStarterDefinitions(page);
  server.counts = { fasts: 0, fieldDefinitions: starter.fields.length, trackableDefinitions: starter.trackables.length, trackableEntries: 3 };

  await page.goto('/#/sync');
  await page.getByRole('button', { name: 'Check sync' }).click();
  const result = page.getByRole('region', { name: 'Check and repair' });
  await expect(result).toContainText('This device and the server differ.');
  await expect(result.getByRole('row', { name: /Entries/ })).toContainText('03');
  expect(server.sent[server.sent.length - 1].check).toBe(true);

  server.counts = { ...server.counts, trackableEntries: 0 };
  await page.getByRole('button', { name: 'Full resync' }).click();
  await expect(result).toContainText('In sync: this device and the server have the same records.');
  const resync = server.sent[server.sent.length - 1];
  expect(resync.cursor).toBe(0);
  expect(resync.changes.fieldDefinitions).toHaveLength(starter.fields.length);
});

test('Sign out goes to Cloudflare\'s sign-out page and the pill then says Signed out', async ({ page }) => {
  const server = await fakeServer(page);
  await page.route('**/cdn-cgi/access/logout', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Signed out</p>' }));
  await waitForStarterSet(page);
  await openSettings(page);

  page.once('dialog', (d) => {
    expect(d.message()).toContain('every device');
    void d.accept();
  });
  const logout = page.waitForRequest((r) => r.isNavigationRequest() && r.url().endsWith('/cdn-cgi/access/logout'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await logout;

  // Reopened while signed out: Access answers 401, and the app knows why.
  server.status = 401;
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Signed out/ }).locator('visible=true')).toBeVisible();
});

test('erasing asks first, says what would be lost, and only then deletes everything here', async ({ page, context }) => {
  const server = await fakeServer(page);
  await page.route('**/cdn-cgi/access/logout', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Signed out</p>' }));
  await waitForStarterSet(page);
  await expect.poll(() => server.sent.some((b) => b.changes.fieldDefinitions.length > 0)).toBe(true);

  // Load Settings once while online: without the service worker its code isn't cached for offline.
  await openSettings(page);
  await page.getByRole('link', { name: /Trackables/ }).locator('visible=true').first().click();

  // A change that can't reach the server: the confirmation says it would be lost, and Cancel keeps everything.
  server.down = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Log Male Health' }).click();
  await openSettings(page);
  await page.getByRole('button', { name: 'Sign out and erase this device' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Erase this device and sign out?' });
  await expect(dialog).toContainText("1 change on this device hasn't reached the server and will be lost.");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  const entries = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('snowfast');
          open.onsuccess = () => {
            const req = open.result.transaction('trackableEntries').objectStore('trackableEntries').count();
            req.onsuccess = () => {
              open.result.close();
              resolve(req.result);
            };
          };
        }),
    );
  expect(await entries()).toBe(1);

  // Back online: the change goes up first, so nothing is lost; Erase deletes the local database and signs out.
  server.down = false;
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sign out and erase this device' }).click();
  await expect(dialog).toContainText('Every change here is on the server, so nothing is lost');
  const logout = page.waitForRequest((r) => r.isNavigationRequest() && r.url().endsWith('/cdn-cgi/access/logout'));
  await dialog.getByRole('button', { name: 'Erase and sign out' }).click();
  await logout;
  await expect(page.getByText('Signed out')).toBeVisible();
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain('snowfast');
});
