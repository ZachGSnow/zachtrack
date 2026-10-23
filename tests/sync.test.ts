import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handleSync, type Env } from '../functions/api/sync';
import { clearAccessKeyCache } from '../server/access';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, forgedToken, ownerClaims, type Signer } from './helpers/access-token';
import { resetDb } from './helpers/d1';

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

/** What another device would receive: everything since `cursor`, sending nothing. */
async function pull(cursor = 0) {
  return (await sync(syncBody(cursor))).body;
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
const trackable = { id: 't-nutrition', name: 'Nutrition', icon: 'x', color: '#f97316', fieldIds: ['f-water'], goalType: 'dailyTotal', goalValue: 64, pinned: true, archived: false, sortOrder: 2, scheduleDays: [0, 2, 4], skipDays: ['2026-10-20'], pausedUntil: 5, createdAt: 1, updatedAt: 1 };
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
    expect(push.body.appliedCounts).toEqual({ fasts: 1, fieldDefinitions: 1, trackableDefinitions: 1, trackableEntries: 1, settings: 1, deletes: 0 });

    const other = await pull(0);
    expect(other.changes.fasts[0]).toMatchObject({ uuid: 'a', tags: ['test'] });
    expect(other.changes.trackableEntries[0].values).toEqual({ 'f-water': 12 });
    expect(other.changes.trackableDefinitions[0].fieldIds).toEqual(['f-water']);
    expect(other.changes.trackableDefinitions[0]).toMatchObject({
      goalType: 'dailyTotal',
      goalValue: 64,
      pinned: true,
      archived: false,
      sortOrder: 2,
      scheduleDays: [0, 2, 4],
      skipDays: ['2026-10-20'],
      pausedUntil: 5,
    });
    expect(other.changes.settings).toMatchObject({ notificationsEnabled: true, heightInches: 70 });

    const again = await sync(syncBody(push.body.cursor));
    expect(again.body.cursor).toBe(5);
    expect(again.body.changes.fasts).toEqual([]);
  });

  it('keeps the newer version of a record (last write wins)', async () => {
    await sync(syncBody(0, { trackableEntries: [entry('e1', 20, 16)] }));
    const stale = await sync(syncBody(0, { trackableEntries: [entry('e1', 10, 8)] }));
    // Not stored, so the device gets the server's newer copy back.
    expect(stale.body.appliedCounts.trackableEntries).toBe(0);
    expect(stale.body.changes.trackableEntries[0].values).toEqual({ 'f-water': 16 });
    const newer = await sync(syncBody(0, { trackableEntries: [entry('e1', 30, 24)] }));
    expect(newer.body.appliedCounts.trackableEntries).toBe(1);
    expect((await pull(0)).changes.trackableEntries[0].values).toEqual({ 'f-water': 24 });
  });

  it('rejects a second fast on the same start day from another device', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)] }));
    const res = await sync(syncBody(0, { fasts: [fast('b', day(20), 11), fast('c', day(21), 11)] }));
    expect(res.body.rejected).toEqual([expect.objectContaining({ recordType: 'fasts', uuid: 'b' })]);
    expect(res.body.changes.fasts.map((f: { uuid: string }) => f.uuid)).toEqual(['a']);
    expect((await pull(0)).changes.fasts.map((f: { uuid: string }) => f.uuid).sort()).toEqual(['a', 'c']);
  });

  it('applies a delete, frees the day, and lets a newer edit beat an older delete', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)], trackableEntries: [entry('e1', 10, 12)] }));
    const del = await sync(
      syncBody(0, {}, [
        { recordType: 'fasts', uuid: 'a', deletedAt: 20 },
        { recordType: 'trackableEntries', uuid: 'e1', deletedAt: 5 },
      ]),
    );
    expect(del.body.appliedCounts.deletes).toBe(1);
    expect(del.body.applied).toEqual([{ recordType: 'fasts', uuid: 'a', deleted: true }]);
    const after = await pull(0);
    expect(after.changes.fasts[0]).toMatchObject({ uuid: 'a', deletedAt: 20 });
    expect(after.changes.trackableEntries[0].deletedAt).toBeUndefined(); // edit at 10 is newer than delete at 5

    const reuse = await sync(syncBody(0, { fasts: [fast('b', day(20), 30)] }));
    expect(reuse.body.rejected).toEqual([]);
  });

  it('pushes a full dataset of seeded size in one request', async () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ ...field, id: `f-${i}`, name: `Field ${i}` }));
    const entries = Array.from({ length: 200 }, (_, i) => entry(`e-${i}`, 5, i));
    const res = await sync(syncBody(0, { fieldDefinitions: fields, trackableEntries: entries }));
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe(240);
    expect(res.body.appliedCounts.trackableEntries).toBe(200);
    expect(res.body.applied).toHaveLength(50); // named up to the limit, counted in full
    expect((await pull(0)).changes.trackableEntries).toHaveLength(200);
  });
});

describe('what a sync sends back', () => {
  it("leaves out the device's own records but includes another device's change to them", async () => {
    const first = await sync(syncBody(0, { trackableEntries: [entry('e1', 10, 12), entry('e2', 10, 8)] }));
    expect(first.body.changes.trackableEntries).toEqual([]);
    expect(first.body.cursor).toBe(2);

    // Another device edits e1 after that.
    await sync(syncBody(0, { trackableEntries: [entry('e1', 20, 16)] }));

    // The first device sends a new entry and receives only the other device's edit.
    const next = await sync(syncBody(first.body.cursor, { trackableEntries: [entry('e3', 30, 4)] }));
    expect(next.body.changes.trackableEntries.map((e: { id: string; values: unknown }) => [e.id, e.values])).toEqual([
      ['e1', { 'f-water': 16 }],
    ]);
    expect(next.body.applied).toEqual([{ recordType: 'trackableEntries', uuid: 'e3' }]);
  });

  it('counts only what changed: a copy the server already has, or an older one, is not applied', async () => {
    await sync(syncBody(0, { fieldDefinitions: [field], trackableEntries: [entry('e1', 20, 16)] }));
    const again = await sync(syncBody(0, { fieldDefinitions: [field], trackableEntries: [entry('e1', 10, 8)] }));
    expect(again.body.appliedCounts).toEqual({ fasts: 0, fieldDefinitions: 0, trackableDefinitions: 0, trackableEntries: 0, settings: 0, deletes: 0 });
    expect(again.body.applied).toEqual([]);
  });

  it('does not count a delete the server already had', async () => {
    await sync(syncBody(0, { trackableEntries: [entry('e1', 10, 12)] }));
    await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 20 }]));
    const again = await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 15 }]));
    expect(again.body.appliedCounts.deletes).toBe(0);
  });
});

describe('check sync', () => {
  it('counts live records when asked, leaving deleted ones out', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)], fieldDefinitions: [field], trackableEntries: [entry('e1', 10, 1), entry('e2', 10, 2)] }));
    await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e2', deletedAt: 20 }]));
    expect((await sync(syncBody(0))).body.counts).toBeUndefined();
    const res = await sync({ ...syncBody(0), check: true });
    expect(res.body.counts).toEqual({ fasts: 1, fieldDefinitions: 1, trackableDefinitions: 0, trackableEntries: 1 });
  });
});

describe('hardening', () => {
  it('rejects a malformed record by itself and still stores the rest of the batch', async () => {
    const res = await sync(
      syncBody(0, {
        fasts: [fast('good', day(20), 10), { uuid: 'no-start', startDay: day(21), method: 'preset', createdAt: 1, updatedAt: 1 }],
        trackableEntries: [entry('e-good', 5, 12), { ...entry('e-bad', 5, 1), values: { 'f-water': 'twelve' } }],
        fieldDefinitions: [{ ...field, kind: 'text' }],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([
      expect.objectContaining({ recordType: 'fasts', uuid: 'no-start', reason: expect.stringContaining('startTime') }),
      expect.objectContaining({ recordType: 'fieldDefinitions', uuid: 'f-water', reason: expect.stringContaining('kind') }),
      expect.objectContaining({ recordType: 'trackableEntries', uuid: 'e-bad', reason: expect.stringContaining('values') }),
    ]);
    const stored = await pull(0);
    expect(stored.changes.fasts.map((f: { uuid: string }) => f.uuid)).toEqual(['good']);
    expect(stored.changes.trackableEntries.map((e: { id: string }) => e.id)).toEqual(['e-good']);
  });

  it('keeps syncing on later requests while a bad record is still on the device', async () => {
    const poison = { ...entry('e-bad', 5, 1), trackableId: undefined };
    await sync(syncBody(0, { trackableEntries: [poison] }));
    const next = await sync(syncBody(0, { trackableEntries: [poison, entry('e-new', 6, 20)] }));
    expect(next.status).toBe(200);
    expect(next.body.applied).toEqual([{ recordType: 'trackableEntries', uuid: 'e-new' }]);
  });

  it('accepts extra local-only properties such as the Dexie id on fasts', async () => {
    const res = await sync(syncBody(0, { fasts: [{ ...fast('a', day(20), 10), id: 7 }] }));
    expect(res.body.rejected).toEqual([]);
  });

  it('rejects a list field that is not a list, and invalid settings, without a 500', async () => {
    const res = await sync({
      cursor: 0,
      changes: { fasts: { uuid: 'x' }, fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: { id: 'other' } },
      tombstones: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.rejected.map((r: { recordType: string }) => r.recordType)).toEqual(['fasts', 'settings']);
  });

  it('skips tombstones with unknown record types instead of failing (including prototype keys)', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)] }));
    const res = await sync(
      syncBody(0, {}, [
        { recordType: '__proto__', uuid: 'a', deletedAt: 20 },
        { recordType: 'constructor', uuid: 'a', deletedAt: 20 },
        { recordType: 'users', uuid: 'a', deletedAt: 20 },
        { recordType: 'fasts', uuid: 'a', deletedAt: 20 },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.body.rejected).toHaveLength(3);
    expect((await pull(0)).changes.fasts[0].deletedAt).toBe(20);
  });

  it('clears notes, tags and values from a deleted entry and fast, but keeps the delete marker', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10, { note: 'felt sick', moodRating: 2 })], trackableEntries: [entry('e1', 10, 12)] }));
    await sync(
      syncBody(0, {}, [
        { recordType: 'fasts', uuid: 'a', deletedAt: 20 },
        { recordType: 'trackableEntries', uuid: 'e1', deletedAt: 20 },
      ]),
    );
    const f = await db.prepare('SELECT note, tags, moodRating, deletedAt, startDay FROM fasts WHERE uuid = ?').bind('a').first();
    expect(f).toEqual({ note: null, tags: null, moodRating: null, deletedAt: 20, startDay: day(20) });
    const e = await db.prepare('SELECT note, tags, fieldValues, deletedAt FROM trackableEntries WHERE id = ?').bind('e1').first();
    expect(e).toEqual({ note: null, tags: null, fieldValues: null, deletedAt: 20 });
  });

  it('d1/scrub-deleted.sql clears rows deleted before this change and leaves live rows alone', async () => {
    await sync(syncBody(0, { trackableEntries: [entry('live', 10, 12), entry('old-delete', 10, 8)] }));
    // A soft delete as the old code wrote it: content still in place.
    await db.prepare('UPDATE trackableEntries SET deletedAt = 20 WHERE id = ?').bind('old-delete').run();
    const script = readFileSync('d1/scrub-deleted.sql', 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of script) await db.prepare(s).run();
    const rows = await db.prepare('SELECT id, note, fieldValues FROM trackableEntries ORDER BY id').all();
    expect(rows.results).toEqual([
      { id: 'live', note: 'sample', fieldValues: '{"f-water":12}' },
      { id: 'old-delete', note: null, fieldValues: null },
    ]);
  });
});
