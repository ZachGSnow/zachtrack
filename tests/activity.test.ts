import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handleSync, type Env } from '../functions/api/sync';
import { handleActivity } from '../functions/api/activity';
import { handleForgetDevice } from '../functions/api/devices';
import { clearAccessKeyCache } from '../server/access';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, ownerClaims, type Signer } from './helpers/access-token';
import { resetDb } from './helpers/d1';

// Devices, the shared activity log and where each change came from, on a
// local D1 built from the schema and every migration.

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let proxy: Proxy;
let db: D1Database;
let signer: Signer;
let token: string;
const NOW = Date.UTC(2026, 9, 23, 12);
const DAY = 24 * 3600_000;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/fixtures/wrangler.test.toml', persist: false });
  db = proxy.env.DB;
  signer = await createSigner();
  token = await signer.sign(ownerClaims(NOW));
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  clearAccessKeyCache();
  await resetDb(db);
});

const env = (): Env => ({ DB: db, OWNER_EMAIL: OWNER, ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD });
const deps = (now = NOW) => ({ now: () => now, fetchKeys: async () => signer.jwks });
const headers = (jwt: string | null = token): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
});

const phone = { id: 'dev-phone', name: 'Phone', appVersion: '1.10.0' };
const laptop = { id: 'dev-laptop', name: 'Laptop', appVersion: '1.9.0' };
const trackable = { id: 't-water', name: 'Water', icon: 'x', color: '#000000', fieldIds: [], createdAt: 1, updatedAt: 1 };
const entry = (id: string, updatedAt: number) => ({ id, trackableId: 't-water', timestamp: 5, createdAt: 1, updatedAt });

async function sync(device: unknown, changes: Record<string, unknown> = {}, cursor = 0, tombstones: unknown[] = [], now = NOW) {
  const body = {
    cursor,
    changes: { fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null, ...changes },
    tombstones,
    device,
  };
  // A token issued at `now`, so syncs dated in the past are valid then.
  const jwt = await signer.sign(ownerClaims(now));
  const res = await handleSync(
    new Request('https://app.example.com/api/sync', { method: 'POST', headers: headers(jwt), body: JSON.stringify(body) }),
    env(),
    deps(now),
  );
  return (await res.json()) as any;
}

async function activity(query = '', jwt: string | null = token) {
  const res = await handleActivity(new Request(`https://app.example.com/api/activity${query}`, { headers: headers(jwt) }), env(), deps());
  return { status: res.status, body: (await res.json()) as any };
}

describe('devices', () => {
  it('records each device with its name and version, and lists them newest first', async () => {
    await sync(laptop, {}, 0, [], NOW - 1000);
    const res = await sync(phone);
    expect(res.devices).toEqual([
      { id: 'dev-phone', name: 'Phone', appVersion: '1.10.0', firstSeenAt: NOW, lastSeenAt: NOW },
      { id: 'dev-laptop', name: 'Laptop', appVersion: '1.9.0', firstSeenAt: NOW - 1000, lastSeenAt: NOW - 1000 },
    ]);
  });

  it('takes a rename and a new version on the next sync, and keeps when it was first seen', async () => {
    await sync(phone, {}, 0, [], NOW - 1000);
    const res = await sync({ ...phone, name: '  My phone  ', appVersion: '1.10.1' });
    expect(res.devices).toEqual([{ id: 'dev-phone', name: 'My phone', appVersion: '1.10.1', firstSeenAt: NOW - 1000, lastSeenAt: NOW }]);
  });

  it('ignores a missing or malformed device, as from an older app, and still syncs', async () => {
    const res = await sync(undefined, { trackableDefinitions: [trackable] });
    expect(res.appliedCounts.trackableDefinitions).toBe(1);
    expect(res.devices).toEqual([]);
    expect((await sync({ id: 'bad id; DROP', name: 'x' })).devices).toEqual([]);
  });

  it('forgets a device on request, and drops devices unseen for 90 days', async () => {
    await sync(laptop, {}, 0, [], NOW - 91 * DAY);
    await sync(phone, {}, 0, [], NOW - DAY);
    expect((await sync({ id: 'dev-tablet', name: 'Tablet' })).devices.map((d: { id: string }) => d.id)).toEqual(['dev-tablet', 'dev-phone']);

    const res = await handleForgetDevice(
      new Request('https://app.example.com/api/devices?id=dev-phone', { method: 'DELETE', headers: headers() }),
      env(),
      deps(),
    );
    expect(((await res.json()) as any).devices.map((d: { id: string }) => d.id)).toEqual(['dev-tablet']);
  });
});

describe('where a change came from', () => {
  it("marks each row with the device that last changed it, and passes that on to other devices", async () => {
    await sync(phone, { trackableDefinitions: [trackable], trackableEntries: [entry('e1', 10)] });
    await sync(laptop, { trackableEntries: [entry('e1', 20)] });
    const other = await sync({ id: 'dev-tablet', name: 'Tablet' });
    expect(other.changes.trackableDefinitions[0].updatedBy).toBe('dev-phone');
    expect(other.changes.trackableEntries[0].updatedBy).toBe('dev-laptop');
  });

  it('marks a delete with the device that made it', async () => {
    await sync(phone, { trackableEntries: [entry('e1', 10)] });
    await sync(laptop, {}, 0, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 20 }]);
    expect(await db.prepare('SELECT updatedBy FROM trackableEntries WHERE id = ?').bind('e1').first('updatedBy')).toBe('dev-laptop');
  });
});

describe('activity', () => {
  it('logs a sync that changed something, with counts and names but no values', async () => {
    await sync(phone, { trackableDefinitions: [trackable], trackableEntries: [{ ...entry('e1', 10), note: 'private note', values: { f: 182 } }] });
    await sync(phone); // nothing changed: not logged
    await sync(laptop, {}, 0, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 20 }]);

    const { status, body } = await activity();
    expect(status).toBe(200);
    expect(body.events.map((e: any) => [e.deviceId, e.counts, e.details])).toEqual([
      ['dev-laptop', { deletes: 1 }, ['Entry deleted -- Water']],
      ['dev-phone', { trackableDefinitions: 1, trackableEntries: 1 }, ['Trackable -- Water', 'Entry -- Water']],
    ]);
    expect(JSON.stringify(body.events)).not.toMatch(/182|private note/);
    expect(body.devices.map((d: { id: string }) => d.id)).toEqual(['dev-phone', 'dev-laptop']);
    expect(body.more).toBe(false);
  });

  it('logs refused records too', async () => {
    await sync(phone, { trackableEntries: [{ ...entry('e1', 10), values: { f: 'twelve' } }] });
    const { body } = await activity();
    expect(body.events).toEqual([expect.objectContaining({ counts: {}, details: [], rejectedCount: 1 })]);
  });

  it('pages through older events and keeps 90 days', async () => {
    await sync(phone, { trackableDefinitions: [trackable] }, 0, [], NOW - 91 * DAY);
    for (let i = 1; i <= 3; i++) await sync(phone, { trackableEntries: [entry(`e${i}`, i)] }, 0, [], NOW - (4 - i) * 1000);

    // The 91-day-old event went when the next sync ran.
    expect(await db.prepare('SELECT COUNT(*) AS n FROM syncEvents').first('n')).toBe(3);
    const first = await activity('?limit=2');
    expect(first.body.events.map((e: any) => e.at)).toEqual([NOW - 1000, NOW - 2000]);
    expect(first.body.more).toBe(true);
    const next = await activity(`?limit=2&before=${NOW - 2000}`);
    expect(next.body.events.map((e: any) => e.at)).toEqual([NOW - 3000]);
    expect(next.body.more).toBe(false);
  });

  it('refuses a request without an Access token', async () => {
    expect((await activity('', null)).status).toBe(403);
  });
});
