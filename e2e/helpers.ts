import { expect, type Page } from '@playwright/test';
import { buildSampleExport, type StarterDefinitions } from './sample-data';

export type SyncMock = { status: number; body?: unknown };

/** An empty successful sync response, optionally with refused records. */
export const okSync = (rejected: unknown[] = []): SyncMock => ({
  status: 200,
  body: { cursor: 1, changes: { fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null }, rejected },
});

/** No sync server at all, like `npm run dev` or a local-only install. */
export const noServer: SyncMock = { status: 404, body: { error: 'Not found' } };

/** What Cloudflare Access answers an expired session with (X-Requested-With: XMLHttpRequest). */
export const loginExpired: SyncMock = { status: 401, body: '' };

/**
 * Answers every POST /api/sync with `mock`. Needs `serviceWorkers: 'block'`
 * in the test, since requests a service worker handles bypass page routes.
 */
export async function mockSync(page: Page, mock: SyncMock | (() => SyncMock)) {
  await page.route('**/api/sync', async (route) => {
    const m = typeof mock === 'function' ? mock() : mock;
    await route.fulfill({
      status: m.status,
      contentType: 'application/json',
      body: typeof m.body === 'string' ? m.body : JSON.stringify(m.body ?? {}),
    });
  });
}

/** Collects console errors and CSP violations; registration errors from a blocked service worker are expected. */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/ServiceWorker|service worker|registerSW/i.test(text)) return;
    // Sync mocks answer 401/404 on purpose; the real Function answers 403 (no Access token) or 503 (CI, no wrangler.toml).
    if (/Failed to load resource: the server responded with a status of (401|403|404|503)/.test(text)) return;
    problems.push(text);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** Reads the starter trackables and fields a fresh install created (read-only). */
export async function readStarterDefinitions(page: Page): Promise<StarterDefinitions> {
  return page.evaluate(
    () =>
      new Promise<StarterDefinitions>((resolve, reject) => {
        const open = indexedDB.open('snowfast');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['trackableDefinitions', 'fieldDefinitions'], 'readonly');
          const t = tx.objectStore('trackableDefinitions').getAll();
          const f = tx.objectStore('fieldDefinitions').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({ trackables: t.result, fields: f.result });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** Opens the Profile sheet from the Trackables tab. */
export async function openProfile(page: Page) {
  await page.goto('/#/trackables');
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
}

/** Waits for a fresh install's starter trackables (created once the first sync attempt settles). */
export async function waitForStarterSet(page: Page) {
  await page.goto('/#/trackables');
  await expect(page.getByText('Body Measurements')).toBeVisible();
  await expect(page.getByText('Wellness Check-in')).toBeVisible();
}

/** Imports fictional sample data through the real Profile > Import file flow. */
export async function importSampleData(page: Page) {
  await waitForStarterSet(page);
  const file = buildSampleExport(await readStarterDefinitions(page), new Date());
  await openProfile(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'sample-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByText(/new records? to add/)).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/^Imported: \d+ added/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}
