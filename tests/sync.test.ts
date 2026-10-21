import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handleSync, type Env } from '../functions/api/sync';
import { clearAccessKeyCache } from '../server/access';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, forgedToken, ownerClaims, type Signer } from './helpers/access-token';

// Runs the real handler against a local D1 (workerd, via Wrangler) built from
// d1/schema.sql, so the upsert SQL, partial unique index and RETURNING all run
// on the same engine as production.

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let proxy: Proxy;
let db: D1Database;
let signer: Signer;
let token: string;
const NOW = Date.UTC(2026, 9, 21, 12);
const day = (d: number) => Date.UTC(2026, 9, d, 4); // stand-in for a local start-of-day

const schemaStatements = readFileSync('d1/schema.sql', 'utf8')
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

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
  for (const t of ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'settings', 'syncSeq']) {
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  for (const s of schemaStatements) await db.prepare(s).run();
});

const env = (overrides: Partial<Env> = {}): Env => ({
  DB: db,
  OWNER_EMAIL: OWNER,
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ...overrides,
});
const deps = () => ({ now: () => NOW, fetchKeys: async () => signer.jwks });

interface Changes {
  fasts?: unknown[];
  fieldDefinitions?: unknown[];
  trackableDefinitions?: unknown[];
  trackableEntries?: unknown[];
  settings?: unknown;
}

function request(body: unknown, jwt: string | null = token): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Cf-Access-Jwt-Assertion'] = jwt;
  return new Request('https://app.example.com/api/sync', { method: 'POST', headers, body: JSON.stringify(body) });
}

function syncBody(cursor: number, changes: Changes = {}, tombstones: unknown[] = []) {
  return {
    cursor,
    changes: {
      fasts: changes.fasts ?? [],
      fieldDefinitions: changes.fieldDefinitions ?? [],
      trackableDefinitions: changes.trackableDefinitions ?? [],
      trackableEntries: changes.trackableEntries ?? [],
      settings: changes.settings ?? null,
    },
    tombstones,
  };
}

async function sync(body: unknown, e: Env = env(), jwt?: string | null) {
  const res = await handleSync(request(body, jwt === undefined ? token : jwt), e, deps());
  return { status: res.status, body: (await res.json()) as any };
}

const fast = (uuid: string, startDay: number, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  uuid,
  startTime: startDay + 20 * 3600000,
  startDay,
  method: 'preset',
  presetId: '16:8',
  tags: ['test'],
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});
const field = { id: 'f-water', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: 1, updatedAt: 1 };
const trackable = { id: 't-nutrition', name: 'Nutrition', icon: 'x', color: '#f97316', fieldIds: ['f-water'], createdAt: 1, updatedAt: 1 };
const entry = (id: string, updatedAt: number, oz: number) => ({
  id,
  trackableId: 't-nutrition',
  timestamp: day(20) + 9 * 3600000,
  note: 'sample',
  values: { 'f-water': oz },
  createdAt: 1,
  updatedAt,
});

describe('auth', () => {
  it('fails closed when the owner or team domain is not configured', async () => {
    expect((await sync(syncBody(0), env({ OWNER_EMAIL: undefined }))).status).toBe(503);
    expect((await sync(syncBody(0), env({ ACCESS_TEAM_DOMAIN: '' }))).status).toBe(503);
  });

  it('rejects a request with no Access token, as on pages.dev', async () => {
    expect((await sync(syncBody(0), env(), null)).status).toBe(403);
  });

  it('rejects a forged token and writes nothing', async () => {
    const res = await sync(syncBody(0, { fasts: [fast('a', day(20), 10)] }), env(), forgedToken(ownerClaims(NOW)));
    expect(res.status).toBe(403);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM fasts').first('n')).toBe(0);
  });

  it('rejects malformed bodies after auth', async () => {
    expect((await sync({ nope: true })).status).toBe(400);
    const res = await handleSync(
      new Request('https://app.example.com/api/sync', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token }, body: 'not json' }),
      env(),
      deps(),
    );
    expect(res.status).toBe(400);
  });
});

describe('sync', () => {
  it('round-trips every record type and advances the cursor', async () => {
    const push = await sync(
      syncBody(0, {
        fasts: [fast('a', day(20), 10)],
        fieldDefinitions: [field],
        trackableDefinitions: [trackable],
        trackableEntries: [entry('e1', 5, 12)],
        settings: { id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: true, heightInches: 70, updatedAt: 3 },
      }),
    );
    expect(push.status).toBe(200);
    expect(push.body.cursor).toBe(5);
    expect(push.body.changes.fasts[0]).toMatchObject({ uuid: 'a', tags: ['test'] });
    expect(push.body.changes.trackableEntries[0].values).toEqual({ 'f-water': 12 });
    expect(push.body.changes.trackableDefinitions[0].fieldIds).toEqual(['f-water']);
    expect(push.body.changes.settings).toMatchObject({ notificationsEnabled: true, heightInches: 70 });

    const again = await sync(syncBody(push.body.cursor));
    expect(again.body.cursor).toBe(5);
    expect(again.body.changes.fasts).toEqual([]);
  });

  it('keeps the newer version of a record (last write wins)', async () => {
    await sync(syncBody(0, { trackableEntries: [entry('e1', 20, 16)] }));
    const stale = await sync(syncBody(0, { trackableEntries: [entry('e1', 10, 8)] }));
    expect(stale.body.changes.trackableEntries[0].values).toEqual({ 'f-water': 16 });
    const newer = await sync(syncBody(0, { trackableEntries: [entry('e1', 30, 24)] }));
    expect(newer.body.changes.trackableEntries[0].values).toEqual({ 'f-water': 24 });
  });

  it('rejects a second fast on the same start day from another device', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)] }));
    const res = await sync(syncBody(0, { fasts: [fast('b', day(20), 11), fast('c', day(21), 11)] }));
    expect(res.body.rejected).toEqual([expect.objectContaining({ recordType: 'fasts', uuid: 'b' })]);
    expect(res.body.changes.fasts.map((f: { uuid: string }) => f.uuid).sort()).toEqual(['a', 'c']);
  });

  it('applies a delete, frees the day, and lets a newer edit beat an older delete', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)], trackableEntries: [entry('e1', 10, 12)] }));
    const del = await sync(
      syncBody(0, {}, [
        { recordType: 'fasts', uuid: 'a', deletedAt: 20 },
        { recordType: 'trackableEntries', uuid: 'e1', deletedAt: 5 },
      ]),
    );
    expect(del.body.changes.fasts[0]).toMatchObject({ uuid: 'a', deletedAt: 20 });
    expect(del.body.changes.trackableEntries[0].deletedAt).toBeUndefined(); // edit at 10 is newer than delete at 5

    const reuse = await sync(syncBody(0, { fasts: [fast('b', day(20), 30)] }));
    expect(reuse.body.rejected).toEqual([]);
  });

  it('pushes a full dataset of seeded size in one request', async () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ ...field, id: `f-${i}`, name: `Field ${i}` }));
    const entries = Array.from({ length: 200 }, (_, i) => entry(`e-${i}`, 5, i));
    const res = await sync(syncBody(0, { fieldDefinitions: fields, trackableEntries: entries }));
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe(240);
    expect(res.body.changes.trackableEntries).toHaveLength(200);
  });
});
