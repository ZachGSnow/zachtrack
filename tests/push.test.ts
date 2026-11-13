import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handlePush } from '../functions/api/push';
import { handleSync, type Env } from '../functions/api/sync';
import { clearAccessKeyCache } from '../server/access';
import { buildReminder, isDue, loadReminderData, localParts, sendDueReminders, shifter, type PushSubscriptionRow } from '../server/reminders';
import { base64urlEncode } from '../server/webpush';
import { isBackupRun } from '../workers/backup/index';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, ownerClaims, type Signer } from './helpers/access-token';
import { resetDb } from './helpers/d1';

// Daily reminders (ARCHITECTURE.md 3.73): the endpoint a device subscribes
// through, and the scheduled run that sends what's due, on a local D1.
// Fictional data.

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let proxy: Proxy;
let db: D1Database;
let signer: Signer;
let token: string;
// Wednesday Nov 11 2026, 8:05 pm in New York.
const NOW = Date.UTC(2026, 10, 12, 1, 5);
const DAY = 86_400_000;
let vapid: { publicKey: string; privateKey: string };
// A browser's subscription keys: any valid P-256 point and 16 bytes.
let browserKey: string;
const AUTH = base64urlEncode(new Uint8Array(16).fill(7));
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/fixtures/wrangler.test.toml', persist: false });
  db = proxy.env.DB;
  signer = await createSigner();
  token = await signer.sign(ownerClaims(NOW));
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  vapid = {
    publicKey: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)),
    privateKey: ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!,
  };
  const browser = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  browserKey = base64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', browser.publicKey)) as ArrayBuffer));
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  clearAccessKeyCache();
  await resetDb(db);
});

const env = (withKeys = true): Env => ({
  DB: db,
  OWNER_EMAIL: OWNER,
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ...(withKeys ? { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://zachtrack.example.com' } : {}),
});
const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
const calls: Array<{ url: string; init?: RequestInit }> = [];
const pushService = (status = 201) =>
  (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status });
  }) as typeof fetch;

async function push(body: unknown, opts: { withKeys?: boolean; method?: string; status?: number } = {}) {
  const request = new Request('https://app.example.com/api/push', {
    method: opts.method ?? 'POST',
    headers: { ...headers, 'Cf-Access-Jwt-Assertion': token },
    ...(opts.method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handlePush(request, env(opts.withKeys ?? true), { now: () => NOW, fetchKeys: async () => signer.jwks, fetcher: pushService(opts.status) });
  return { status: res.status, body: (await res.json()) as any };
}

const save = (extra: Record<string, unknown> = {}) => ({
  action: 'save',
  endpoint: ENDPOINT,
  keys: { p256dh: browserKey, auth: AUTH },
  deviceId: 'dev-phone',
  timeZone: 'America/New_York',
  remindAt: '20:00',
  include: { habits: true, tasks: true, dates: true },
  named: false,
  ...extra,
});

/** Fictional data through the real sync endpoint: an overdue habit, a limit goal, a task due today and one done. */
async function seed() {
  const t = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, icon: 'x', color: '#000000', fieldIds: [], createdAt: 1, updatedAt: 1, ...extra });
  const e = (id: string, trackableId: string, at: number) => ({ id, trackableId, timestamp: at, createdAt: 1, updatedAt: 1 });
  const task = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, sortOrder: 1, createdAt: 1, updatedAt: 1, ...extra });
  const body = {
    cursor: 0,
    changes: {
      fasts: [],
      fieldDefinitions: [],
      trackableDefinitions: [t('plants', 'Water the plants', { goalType: 'everyDays', goalValue: 3 }), t('snacks', 'Snacks', { goalType: 'maxPerWeek', goalValue: 1 })],
      trackableEntries: [e('e1', 'plants', Date.UTC(2026, 10, 6, 15)), e('e2', 'snacks', NOW - DAY), e('e3', 'snacks', NOW - 2 * DAY)],
      taskProjects: [],
      tasks: [task('rent', 'Pay rent', { dueOn: '2026-11-11' }), task('later', 'Book flights', { dueOn: '2026-11-20' }), task('done', 'Old one', { dueOn: '2026-11-01', completedAt: NOW - DAY })],
      taskCompletions: [],
      settings: null,
    },
    tombstones: [],
    device: { id: 'dev-phone', name: 'Phone', appVersion: '1.22.0' },
  };
  const res = await handleSync(new Request('https://app.example.com/api/sync', { method: 'POST', headers: { ...headers, 'Cf-Access-Jwt-Assertion': token }, body: JSON.stringify(body) }), env(), {
    now: () => NOW,
    fetchKeys: async () => signer.jwks,
  });
  expect(res.status).toBe(200);
}

describe('the push endpoint', () => {
  it('gives the public key, or null when reminders are not set up', async () => {
    expect((await push(null, { method: 'GET' })).body).toEqual({ publicKey: vapid.publicKey });
    expect((await push(null, { method: 'GET', withKeys: false })).body).toEqual({ publicKey: null });
  });

  it('saves, reads back and deletes a subscription, and checks what it is given', async () => {
    expect((await push({ action: 'get', endpoint: ENDPOINT })).body).toEqual({ settings: null });
    const saved = await push(save({ named: true, include: { habits: true, tasks: false, dates: true } }));
    expect(saved.body.settings).toEqual({ remindAt: '20:00', include: { habits: true, tasks: false, dates: true }, named: true, lastSentOn: null });
    expect((await push({ action: 'get', endpoint: ENDPOINT })).body.settings.remindAt).toBe('20:00');
    expect((await push(save({ remindAt: '07:30' }))).body.settings.remindAt).toBe('07:30');

    expect((await push(save({ endpoint: 'https://evil.example.com/x' }))).body).toEqual({ error: 'Invalid endpoint host' });
    expect((await push(save({ timeZone: 'Mars/Olympus' }))).status).toBe(400);
    expect((await push(save({ remindAt: '25:00' }))).status).toBe(400);
    expect((await push(save(), { withKeys: false })).status).toBe(503);

    await push({ action: 'delete', endpoint: ENDPOINT });
    expect((await push({ action: 'get', endpoint: ENDPOINT })).body).toEqual({ settings: null });
  });

  it('sends a test, encrypted and signed, and forgets a subscription the push service dropped', async () => {
    await push(save());
    calls.length = 0;
    expect((await push({ action: 'test', endpoint: ENDPOINT })).body).toEqual({ outcome: 'sent' });
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].init?.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm' });
    expect(String((calls[0].init?.headers as Record<string, string>).Authorization)).toMatch(/^vapid t=.+, k=/);

    expect((await push({ action: 'test', endpoint: ENDPOINT }, { status: 410 })).body).toEqual({ outcome: 'gone' });
    expect((await push({ action: 'get', endpoint: ENDPOINT })).body).toEqual({ settings: null });
  });

  it('refuses requests without the Access token', async () => {
    const res = await handlePush(new Request('https://app.example.com/api/push', { method: 'POST', headers, body: '{}' }), env(), { fetchKeys: async () => signer.jwks });
    expect(res.status).toBe(403);
  });
});

describe('when a reminder is due', () => {
  const row = (extra: Partial<PushSubscriptionRow> = {}) => ({ timeZone: 'America/New_York', remindAt: '20:00', lastSentOn: null, failures: 0, ...extra });

  it('goes once a day, from its time until three hours later', () => {
    expect(localParts(NOW, 'America/New_York')).toMatchObject({ date: '2026-11-11', minutes: 20 * 60 + 5 });
    expect(isDue(row(), NOW)).toBe(true);
    expect(isDue(row({ lastSentOn: '2026-11-11' }), NOW)).toBe(false);
    expect(isDue(row({ remindAt: '20:30' }), NOW)).toBe(false);
    expect(isDue(row({ remindAt: '16:00' }), NOW)).toBe(false);
    expect(isDue(row({ failures: 5 }), NOW)).toBe(false);
    // Tokyo is already at 10:05 am on Thursday.
    expect(isDue(row({ timeZone: 'Asia/Tokyo', remindAt: '10:00', lastSentOn: '2026-11-11' }), NOW)).toBe(true);
  });

  it("reads days in the device's time zone, whatever the server's", () => {
    // 11:30 pm Tuesday in Tokyo is 2:30 pm UTC: it must read as Tuesday at 23:30.
    const t = Date.UTC(2026, 10, 10, 14, 30);
    const moved = new Date(shifter('Asia/Tokyo')(t));
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([10, 23, 30]);
    // Across New York's DST change: noon on each side stays noon.
    const ny = shifter('America/New_York');
    expect(new Date(ny(Date.UTC(2026, 9, 31, 16))).getHours()).toBe(12);
    expect(new Date(ny(Date.UTC(2026, 10, 2, 17))).getHours()).toBe(12);
    // The backup keeps 09:00 UTC; reminders take every other run.
    expect(isBackupRun(new Date(Date.UTC(2026, 10, 12, 9, 0)))).toBe(true);
    expect(isBackupRun(new Date(Date.UTC(2026, 10, 12, 9, 15)))).toBe(false);
  });
});

describe('the reminder', () => {
  it("says what's due, by count unless names are asked for, and leaves out limit goals and later tasks", async () => {
    await seed();
    const data = await loadReminderData(db, NOW);
    const base = { timeZone: 'America/New_York', includeHabits: 1, includeTasks: 1, includeDates: 1, namedText: 0 };
    expect(buildReminder(data, base, NOW)).toMatchObject({ count: 2, body: '1 habit and 1 task need a look today.' });
    expect(buildReminder(data, { ...base, namedText: 1 }, NOW).body).toBe('Water the plants: Overdue by 2d\nPay rent');
    expect(buildReminder(data, { ...base, includeTasks: 0 }, NOW)).toMatchObject({ count: 1, body: '1 habit needs a look today.' });
    expect(buildReminder(data, { ...base, includeHabits: 0, includeTasks: 0 }, NOW).count).toBe(0);
  });

  it('sends each due device its reminder once, and drops a subscription the push service no longer has', async () => {
    await seed();
    await push(save());
    await push(save({ endpoint: 'https://fcm.googleapis.com/fcm/send/old-phone' }));
    const keys = { DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
    calls.length = 0;
    const gone = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: String(url).endsWith('old-phone') ? 410 : 201 });
    }) as typeof fetch;

    const run = await sendDueReminders(keys, NOW, gone);
    expect(run.outcomes.map((o) => o.outcome).sort()).toEqual(['gone', 'sent']);
    expect(calls).toHaveLength(2);
    const rows = (await db.prepare('SELECT endpoint, lastSentOn FROM pushSubscriptions').all()).results;
    expect(rows).toEqual([{ endpoint: ENDPOINT, lastSentOn: '2026-11-11' }]);

    // Fifteen minutes later: already sent today.
    calls.length = 0;
    expect((await sendDueReminders(keys, NOW + 15 * 60_000, gone)).outcomes).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('retries a failed send on the next run, and sends nothing without the keys', async () => {
    await seed();
    await push(save());
    const keys = { DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
    expect((await sendDueReminders(keys, NOW, pushService(500))).outcomes[0].outcome).toBe('failed');
    expect((await sendDueReminders(keys, NOW + 15 * 60_000, pushService(201))).outcomes[0].outcome).toBe('sent');
    await db.prepare('UPDATE pushSubscriptions SET lastSentOn = NULL').run();
    calls.length = 0;
    expect((await sendDueReminders({ DB: db }, NOW, pushService())).outcomes).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
