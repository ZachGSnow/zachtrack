import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { okSync, watchForProblems } from './helpers';

// Daily reminders (ARCHITECTURE.md 3.73): Settings > Reminders against a
// stand-in /api/push. The service worker runs here (Settings waits for it),
// so routes go on the context, which also sees its requests. Headless
// Chromium has neither a push service nor notifications (it reports the
// permission as denied), so both are stubbed; the service worker's push
// handler is tested on its own in tests/pushSw.test.ts.
test.use({ serviceWorkers: 'allow' });

const PUBLIC_KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';

interface Saved {
  remindAt: string;
  include: { habits: boolean; tasks: boolean; dates: boolean };
  named: boolean;
  timeZone?: string;
  deviceId?: string;
}

async function standIns(context: BrowserContext) {
  const server: { saved: Saved | null; actions: string[] } = { saved: null, actions: [] };
  await context.route('**/api/sync', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okSync().body) }));
  await context.route('**/api/push', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publicKey: PUBLIC_KEY }) });
    const body = request.postDataJSON();
    server.actions.push(body.action);
    const settings = () => (server.saved ? { remindAt: server.saved.remindAt, include: server.saved.include, named: server.saved.named, lastSentOn: null } : null);
    if (body.action === 'save') server.saved = { remindAt: body.remindAt, include: body.include, named: body.named, timeZone: body.timeZone, deviceId: body.deviceId };
    if (body.action === 'delete') server.saved = null;
    const reply = body.action === 'test' ? { outcome: 'sent' } : { settings: settings() };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  // A stand-in push subscription, since headless Chromium has no push service.
  await context.addInitScript(() => {
    // Kept across reloads, as a real subscription is.
    const KEY = 'e2e-push-subscribed';
    const fake = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => {
        sessionStorage.removeItem(KEY);
        return true;
      },
    };
    if (!(window as unknown as { e2eDenied?: boolean }).e2eDenied) {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
      Notification.requestPermission = async () => 'granted';
    }
    if ('PushManager' in self) {
      PushManager.prototype.getSubscription = async function () {
        return (sessionStorage.getItem(KEY) ? fake : null) as PushSubscription | null;
      };
      PushManager.prototype.subscribe = async function () {
        sessionStorage.setItem(KEY, '1');
        return fake as unknown as PushSubscription;
      };
    }
  });
  return server;
}

async function openReminders(page: Page) {
  await page.goto('/#/settings');
  const section = page.getByRole('region', { name: 'Reminders' });
  await expect(section).toBeVisible();
  return section;
}

test('reminders turn on with permission, save their choices, send a test and turn off', async ({ page, context }) => {
  const problems = watchForProblems(page);
  const server = await standIns(context);
  const section = await openReminders(page);

  await section.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reminders are on.' })).toBeVisible();
  expect(server.saved).toMatchObject({ remindAt: '20:00', include: { habits: true, tasks: true, dates: true }, named: false });
  expect(server.saved?.timeZone).toBeTruthy();
  expect(server.saved?.deviceId).toBeTruthy();

  await section.getByLabel('Remind me at').fill('07:30');
  await section.getByRole('checkbox', { name: 'Tasks due today or overdue' }).uncheck();
  await section.getByRole('checkbox', { name: /Name what's due/ }).check();
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('Saved.');
  expect(server.saved).toMatchObject({ remindAt: '07:30', include: { habits: true, tasks: false, dates: true }, named: true });

  await section.getByRole('button', { name: 'Send a test' }).click();
  await expect(section.getByRole('status')).toContainText('Test sent');

  // Coming back to Settings reads the saved choices.
  await page.reload();
  await expect(section.getByLabel('Remind me at')).toHaveValue('07:30');
  await expect(section.getByRole('checkbox', { name: 'Tasks due today or overdue' })).not.toBeChecked();

  await section.getByRole('button', { name: 'Turn off' }).click();
  await expect(section.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  expect(server.actions).toContain('delete');
  expect(problems).toEqual([]);
});

test('blocked notifications say how to allow them', async ({ page, context }) => {
  // The headless browser reports notifications as denied, as a phone does once they're blocked.
  await context.addInitScript(() => {
    (window as unknown as { e2eDenied?: boolean }).e2eDenied = true;
  });
  await standIns(context);
  const section = await openReminders(page);
  await expect(section).toContainText('Notifications are blocked for ZachTrack');
});
