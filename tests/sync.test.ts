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
  taskProjects?: unknown[];
  tasks?: unknown[];
  taskCompletions?: unknown[];
  settings?: unknown;
}

function request(body: unknown, jwt: string | null = token): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
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
      ...(changes.taskProjects ? { taskProjects: changes.taskProjects } : {}),
      ...(changes.tasks ? { tasks: changes.tasks } : {}),
      ...(changes.taskCompletions ? { taskCompletions: changes.taskCompletions } : {}),
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

  it('fails closed without the Access audience tag too', async () => {
    expect((await sync(syncBody(0), env({ ACCESS_AUD: undefined }))).status).toBe(503);
  });

  it('refuses a write that did not come from the app itself (cross-site request forgery), and writes nothing', async () => {
    const body = JSON.stringify(syncBody(0, { fasts: [fast('csrf', day(20), 10)] }));
    const post = (headers: Record<string, string>) =>
      handleSync(new Request('https://app.example.com/api/sync', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, ...headers }, body }), env(), deps());
    // A form post from another site: text/plain, no custom header.
    expect((await post({ 'Content-Type': 'text/plain' })).status).toBe(403);
    // The app's header, but the browser says it came from elsewhere.
    expect((await post({ 'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await post({ 'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM fasts').first('n')).toBe(0);
    // The app itself.
    expect((await post({ 'X-Requested-With': 'XMLHttpRequest', 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
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
      new Request('https://app.example.com/api/sync', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, 'X-Requested-With': 'XMLHttpRequest' }, body: 'not json' }),
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
        settings: {
          id: 'app-settings',
          defaultPresetId: '16:8',
          notificationsEnabled: true,
          heightInches: 70,
          fastWeekPlan: [null, null, null, null, null, { rest: true }, { presetId: '24h-custom', time: '19:30' }],
          updatedAt: 3,
        },
      }),
    );
    expect(push.status).toBe(200);
    expect(push.body.cursor).toBe(5);
    expect(push.body.appliedCounts).toEqual({ fasts: 1, fieldDefinitions: 1, trackableDefinitions: 1, trackableEntries: 1, taskProjects: 0, tasks: 0, taskCompletions: 0, settings: 1, deletes: 0 });

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
    expect(other.changes.settings.fastWeekPlan).toEqual([null, null, null, null, null, { rest: true }, { presetId: '24h-custom', time: '19:30' }]);

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
    expect(again.body.appliedCounts).toEqual({ fasts: 0, fieldDefinitions: 0, trackableDefinitions: 0, trackableEntries: 0, taskProjects: 0, tasks: 0, taskCompletions: 0, settings: 0, deletes: 0 });
    expect(again.body.applied).toEqual([]);
  });

  it('does not count a delete the server already had', async () => {
    await sync(syncBody(0, { trackableEntries: [entry('e1', 10, 12)] }));
    await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 20 }]));
    const again = await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e1', deletedAt: 15 }]));
    expect(again.body.appliedCounts.deletes).toBe(0);
  });
});

describe('dates', () => {
  it('round-trips date kinds, lead days and repeat rules, and refuses malformed rules', async () => {
    const holidays = { ...trackable, id: 't-holidays', displayMode: 'ages', dateKind: 'holiday', dateLeadDays: 3, fieldIds: [] };
    const thanksgiving = { ...entry('e-tg', 5, 0), trackableId: 't-holidays', values: undefined, note: 'Thanksgiving', dateRepeat: { type: 'nthWeekday', month: 10, weekday: 3, nth: 4 } };
    await sync(syncBody(0, { trackableDefinitions: [holidays], trackableEntries: [thanksgiving] }));
    const other = await pull(0);
    expect(other.changes.trackableDefinitions[0]).toMatchObject({ dateKind: 'holiday', dateLeadDays: 3 });
    expect(other.changes.trackableEntries[0].dateRepeat).toEqual({ type: 'nthWeekday', month: 10, weekday: 3, nth: 4 });

    for (const bad of [{ type: 'weekly' }, { type: 'every', count: 0, unit: 'years' }, { type: 'nthWeekday', month: 12, weekday: 0, nth: 1 }, { type: 'yearly', extra: 1 }]) {
      const res = await sync(syncBody(0, { trackableEntries: [{ ...thanksgiving, id: 'e-bad', dateRepeat: bad }] }));
      expect(res.body.rejected).toEqual([expect.objectContaining({ uuid: 'e-bad', reason: expect.stringContaining('dateRepeat') })]);
    }
    const badKind = await sync(syncBody(0, { trackableDefinitions: [{ ...holidays, id: 't-bad', dateKind: 'wedding' }] }));
    expect(badKind.body.rejected).toEqual([expect.objectContaining({ uuid: 't-bad', reason: expect.stringContaining('dateKind') })]);
  });
});

describe('weekly plan', () => {
  it('rejects a malformed plan in settings', async () => {
    const settings = (fastWeekPlan: unknown) => ({ id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: false, fastWeekPlan, updatedAt: 5 });
    for (const bad of [[null], Array(7).fill({ time: '25:00' }), Array(7).fill({ rest: 'yes' })]) {
      const res = await sync(syncBody(0, { settings: settings(bad) }));
      expect(res.body.rejected).toEqual([expect.objectContaining({ recordType: 'settings', reason: expect.stringContaining('fastWeekPlan') })]);
    }
  });
});

describe('check sync', () => {
  it('counts live records when asked, leaving deleted ones out', async () => {
    await sync(syncBody(0, { fasts: [fast('a', day(20), 10)], fieldDefinitions: [field], trackableEntries: [entry('e1', 10, 1), entry('e2', 10, 2)] }));
    await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e2', deletedAt: 20 }]));
    expect((await sync(syncBody(0))).body.counts).toBeUndefined();
    const res = await sync({ ...syncBody(0), check: true });
    expect(res.body.counts).toEqual({ fasts: 1, fieldDefinitions: 1, trackableDefinitions: 0, trackableEntries: 1, taskProjects: 0, tasks: 0, taskCompletions: 0 });
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

describe('insight controls and date notes (v1.17.0)', () => {
  it('round-trips insightsHidden, mutedInsights and date details, and refuses malformed muted keys', async () => {
    const hidden = { ...trackable, id: 't-hidden', insightsHidden: true, scheduleHistory: [{ until: 1000, scheduleDays: [0, 1] }, { until: 2000 }] };
    const dated = { ...entry('e-bday', 5, 0), values: undefined, note: 'Alex', details: 'Gift: coffee beans' };
    const settings = { id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: false, mutedInsights: ['t1|t2|0', 't1|t3|1'], updatedAt: 5 };
    await sync(syncBody(0, { trackableDefinitions: [hidden], trackableEntries: [dated], settings }));
    const other = await pull(0);
    expect(other.changes.trackableDefinitions[0].insightsHidden).toBe(true);
    expect(other.changes.trackableDefinitions[0].scheduleHistory).toEqual([{ until: 1000, scheduleDays: [0, 1] }, { until: 2000 }]);
    expect(other.changes.trackableEntries[0].details).toBe('Gift: coffee beans');
    expect(other.changes.settings.mutedInsights).toEqual(['t1|t2|0', 't1|t3|1']);

    for (const bad of [['t1|t2'], ['t1|t2|2'], 'not a list', [42]]) {
      const res = await sync(syncBody(0, { settings: { ...settings, mutedInsights: bad, updatedAt: 9 } }));
      expect(res.body.rejected).toEqual([expect.objectContaining({ recordType: 'settings', reason: expect.stringContaining('mutedInsights') })]);
    }
  });

  it('clears a deleted date entry\'s notes on the server', async () => {
    await sync(syncBody(0, { trackableEntries: [{ ...entry('e-gone', 5, 0), values: undefined, note: 'Sam', details: 'Size S' }] }));
    await sync(syncBody(0, {}, [{ recordType: 'trackableEntries', uuid: 'e-gone', deletedAt: 20 }]));
    const row = await db.prepare('SELECT details, note FROM trackableEntries WHERE id = ?').bind('e-gone').first<{ details: string | null; note: string | null }>();
    expect(row).toEqual({ details: null, note: null });
  });
});

describe('tasks (v1.19.0)', () => {
  const project = {
    id: 'p-home',
    name: 'Home',
    color: '#3b82f6',
    icon: 'x',
    notes: 'House jobs',
    sections: [
      { id: 's-now', name: 'In flight' },
      { id: 's-next', name: 'Queued' },
    ],
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Task ${id}`,
    projectId: 'p-home',
    sectionId: 's-now',
    sortOrder: 1.5,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  });
  const repeating = task('k-filter', {
    name: 'Replace the furnace filter',
    notes: 'Size 16x25x1',
    dueOn: '2026-12-01',
    dueTime: '09:30',
    repeat: { type: 'monthsNth', every: 3, nth: 1, weekday: 2 },
  });
  const subtask = task('k-sub', { projectId: undefined, sectionId: undefined, parentId: 'k-filter', completedAt: 5 });
  const completion = { id: 'c-1', taskId: 'k-filter', completedAt: 4, dueOn: '2026-09-01', nextDueOn: '2026-12-01', subtaskIds: ['k-sub'], createdAt: 4, updatedAt: 4 };

  it('round-trips projects with their sections, tasks with subtasks and repeat rules, and completions', async () => {
    const push = await sync(syncBody(0, { taskProjects: [project], tasks: [repeating, subtask], taskCompletions: [completion] }));
    expect(push.body.rejected).toEqual([]);
    expect(push.body.appliedCounts).toMatchObject({ taskProjects: 1, tasks: 2, taskCompletions: 1 });

    const other = await pull(0);
    expect(other.changes.taskProjects).toEqual([{ ...project }]);
    const byId = Object.fromEntries(other.changes.tasks.map((t: { id: string }) => [t.id, t]));
    expect(byId['k-filter']).toEqual(repeating);
    expect(byId['k-sub']).toMatchObject({ parentId: 'k-filter', completedAt: 5 });
    expect(byId['k-sub'].projectId).toBeUndefined();
    expect(other.changes.taskCompletions).toEqual([completion]);
  });

  it('works with an app that sends no task lists at all', async () => {
    await sync(syncBody(0, { taskProjects: [project] }));
    const old = await sync(syncBody(0, { trackableEntries: [entry('e1', 5, 12)] }));
    expect(old.status).toBe(200);
    expect(old.body.changes.taskProjects).toHaveLength(1);
  });

  it('refuses malformed tasks, projects and completions one by one', async () => {
    const bad: Array<[string, Record<string, unknown>, string]> = [
      ['tasks', task('k1', { dueOn: '2026-02-30' }), 'dueOn'],
      ['tasks', task('k2', { repeat: { type: 'days', every: 1 } }), 'repeat needs dueOn'],
      ['tasks', task('k3', { dueTime: '09:30' }), 'dueTime needs dueOn'],
      ['tasks', task('k4', { dueOn: '2026-12-01', repeat: { type: 'weeks', every: 1, weekdays: [] } }), 'repeat'],
      ['tasks', task('k5', { dueOn: '2026-12-01', repeat: { type: 'afterDone', every: 400, unit: 'days' } }), 'repeat'],
      ['tasks', task('k6', { dueOn: '2026-12-01', repeat: { type: 'days', every: 1, extra: true } }), 'repeat'],
      ['tasks', task('k7', { parentId: 'k7' }), 'parentId'],
      ['tasks', task('k8', { sortOrder: undefined }), 'sortOrder'],
      ['taskProjects', { ...project, id: 'p-dup', sections: [{ id: 's', name: 'A' }, { id: 's', name: 'B' }] }, 'sections'],
      ['taskCompletions', { ...completion, id: 'c-bad', nextDueOn: 'soon' }, 'nextDueOn'],
    ];
    for (const [kind, record, reason] of bad) {
      const res = await sync(syncBody(0, { [kind]: [record] }));
      expect(res.body.rejected).toEqual([expect.objectContaining({ recordType: kind, uuid: record.id, reason: expect.stringContaining(reason) })]);
    }
    const good = await sync(syncBody(0, { tasks: [task('k-ok', { dueOn: '2028-02-29', repeat: { type: 'months', every: 1, day: -1 } })] }));
    expect(good.body.rejected).toEqual([]);
  });

  it("clears a deleted task's name and notes and a deleted project's notes, keeping the project name", async () => {
    await sync(syncBody(0, { taskProjects: [project], tasks: [repeating] }));
    await sync(
      syncBody(0, {}, [
        { recordType: 'tasks', uuid: 'k-filter', deletedAt: 20 },
        { recordType: 'taskProjects', uuid: 'p-home', deletedAt: 20 },
      ]),
    );
    expect(await db.prepare('SELECT name, notes, deletedAt FROM tasks WHERE id = ?').bind('k-filter').first()).toEqual({ name: '', notes: null, deletedAt: 20 });
    expect(await db.prepare('SELECT name, notes, deletedAt FROM taskProjects WHERE id = ?').bind('p-home').first()).toEqual({
      name: 'Home',
      notes: null,
      deletedAt: 20,
    });
    const after = await pull(0);
    expect(after.changes.tasks[0]).toMatchObject({ id: 'k-filter', deletedAt: 20 });
  });

  it('names a task in the shared activity by its project, never by its own name', async () => {
    await sync({ ...syncBody(0, { taskProjects: [project], tasks: [repeating, subtask] }), device: { id: 'dev-1', name: 'Phone' } });
    const row = await db.prepare('SELECT details FROM syncEvents').first<{ details: string }>();
    const details: string[] = JSON.parse(row!.details);
    expect(details).toEqual(expect.arrayContaining(['Project -- Home', 'Task -- Home', 'Task']));
    expect(details.join(' ')).not.toContain('furnace');
  });

  it('counts live tasks for Check sync', async () => {
    await sync(syncBody(0, { taskProjects: [project], tasks: [repeating, subtask], taskCompletions: [completion] }));
    await sync(syncBody(0, {}, [{ recordType: 'tasks', uuid: 'k-sub', deletedAt: 20 }]));
    const res = await sync({ ...syncBody(0), check: true });
    expect(res.body.counts).toMatchObject({ taskProjects: 1, tasks: 1, taskCompletions: 1 });
  });
});

describe('change times and display fields (v1.21.0)', () => {
  it('refuses a record or a delete stamped in the future, and a colour that is not a colour', async () => {
    const future = Date.now() + 3 * 24 * 3600_000;
    const res = await sync(
      syncBody(0, { trackableEntries: [entry('e-future', future, 1)], trackableDefinitions: [{ ...trackable, id: 't-css', color: 'red; position: fixed' }] }, [
        { recordType: 'fasts', uuid: 'a', deletedAt: future },
      ]),
    );
    expect(res.body.rejected.map((r: { recordType: string; reason: string }) => [r.recordType, r.reason])).toEqual([
      ['trackableDefinitions', expect.stringContaining('hex colour')],
      ['trackableEntries', expect.stringContaining('no later than tomorrow')],
      ['tombstones', expect.stringContaining('no later than tomorrow')],
    ]);
    // A clock a few hours fast is fine.
    const soon = await sync(syncBody(0, { trackableEntries: [entry('e-soon', Date.now() + 3 * 3600_000, 1)] }));
    expect(soon.body.rejected).toEqual([]);
  });
});

describe('sync in parts (v1.21.0)', () => {
  it('refuses a request with more records than one request may carry, and writes nothing', async () => {
    const res = await sync(syncBody(0, { trackableEntries: Array.from({ length: 2001 }, (_, i) => entry(`e-${i}`, 5, i)) }));
    expect(res.status).toBe(413);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM trackableEntries').first('n')).toBe(0);
  });

  it('hands out a large pull a page at a time, oldest first across tables, until nothing is left', async () => {
    await sync(syncBody(0, { fieldDefinitions: [field], trackableEntries: Array.from({ length: 1300 }, (_, i) => entry(`e-${i}`, 5, i)) }));
    await sync(syncBody(0, { fasts: [fast('late', day(20), 10)] }));

    const first = await pull(0);
    const firstIds = [...first.changes.fieldDefinitions, ...first.changes.trackableEntries, ...first.changes.fasts];
    expect(firstIds).toHaveLength(1000);
    expect(first.more).toBe(true);
    // The field went in first (lowest serverSeq), the fast last: it waits for a later page.
    expect(first.changes.fieldDefinitions).toHaveLength(1);
    expect(first.changes.fasts).toHaveLength(0);
    expect(first.cursor).toBe(1000);

    const second = await pull(first.cursor);
    expect(second.changes.trackableEntries).toHaveLength(301);
    expect(second.changes.fasts.map((f: { uuid: string }) => f.uuid)).toEqual(['late']);
    expect(second.more).toBeUndefined();
    expect(second.cursor).toBe(1302);
    const all = new Set([...first.changes.trackableEntries, ...second.changes.trackableEntries].map((e: { id: string }) => e.id));
    expect(all.size).toBe(1300);
  });
});
