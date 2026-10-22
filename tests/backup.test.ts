import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handleSync } from '../functions/api/sync';
import { BACKUP_TABLES, sqlLiteral } from '../server/backup';
import { runBackup } from '../workers/backup/index';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, ownerClaims, type Signer } from './helpers/access-token';

// Seeds a local D1 through the real sync endpoint, runs the backup Worker's
// job into local R2, then restores the file into a second database and
// compares every table.

type Bindings = { DB: D1Database; RESTORE_DB: D1Database; BACKUPS: R2Bucket };
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Bindings>>>;
let env: Bindings;
let signer: Signer;
let token: string;
const NOW = Date.UTC(2026, 9, 22, 9);

const schema = readFileSync('d1/schema.sql', 'utf8')
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

async function resetDb(db: D1Database) {
  for (const t of [...BACKUP_TABLES, 'syncSeq']) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  for (const s of schema) await db.prepare(s).run();
}

/** Applies a backup file the way `wrangler d1 execute --file` would: one statement per line. */
async function applySql(db: D1Database, sql: string) {
  const statements = sql.split('\n').filter((l) => l.trim() && !l.startsWith('--'));
  for (const s of statements) await db.prepare(s).run();
  return statements.length;
}

async function sync(db: D1Database, body: unknown) {
  const res = await handleSync(
    new Request('https://app.example.com/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify(body),
    }),
    { DB: db, OWNER_EMAIL: OWNER, ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD },
    { now: () => NOW, fetchKeys: async () => signer.jwks },
  );
  return (await res.json()) as any;
}

const changes = (c: Record<string, unknown>) => ({
  cursor: 0,
  changes: { fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], settings: null, ...c },
  tombstones: [],
});

// Text that has broken naive SQL dumps: quotes, a semicolon then a newline,
// CRLF, a statement-looking line, emoji and non-Latin text.
const trickyNote = "Felt 'ok'; slept late\nDELETE FROM fasts;\r\nnext line \ud83d\ude34 \u65e5\u672c";

async function seed(db: D1Database) {
  await sync(
    db,
    changes({
      fieldDefinitions: [
        { id: 'f-water', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: 1, updatedAt: 1 },
        { id: 'f-mood', name: 'Mood', kind: 'rating', ratingMin: 1, ratingMax: 5, createdAt: 1, updatedAt: 1 },
      ],
      trackableDefinitions: [
        { id: 't-n', name: 'Nutrition', icon: '\ud83c\udf7d\ufe0f', color: '#f97316', fieldIds: ['f-water'], createdAt: 1, updatedAt: 1 },
      ],
      trackableEntries: [
        { id: 'e1', trackableId: 't-n', timestamp: NOW - 3600000, note: trickyNote, tags: ['a', "b'c"], values: { 'f-water': 12.5 }, createdAt: 2, updatedAt: 2 },
        { id: 'e2', trackableId: 't-n', timestamp: NOW, values: { 'f-water': 8 }, createdAt: 3, updatedAt: 3 },
      ],
      fasts: [
        {
          uuid: 'fast-1',
          startTime: NOW - 20 * 3600000,
          startDay: NOW - 24 * 3600000,
          endTime: NOW - 4 * 3600000,
          method: 'preset',
          presetId: '16:8',
          targetHours: 16,
          moodRating: 4,
          note: trickyNote,
          createdAt: 4,
          updatedAt: 4,
        },
      ],
      settings: { id: 'app-settings', defaultPresetId: '16:8', notificationsEnabled: false, heightInches: 70.5, updatedAt: 5 },
    }),
  );
  // A deleted entry: the backup keeps the delete marker so devices still learn about it.
  await sync(db, changes({ trackableEntries: [{ id: 'e3', trackableId: 't-n', timestamp: NOW, createdAt: 6, updatedAt: 6 }] }));
  await sync(db, { cursor: 0, changes: changes({}).changes, tombstones: [{ recordType: 'trackableEntries', uuid: 'e3', deletedAt: 7 }] });
}

async function tableRows(db: D1Database, table: string) {
  const res = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>();
  return res.results.map(({ serverSeq: _seq, ...rest }) => rest);
}

beforeAll(async () => {
  proxy = await getPlatformProxy<Bindings>({ configPath: 'tests/fixtures/wrangler.test.toml', persist: false });
  env = proxy.env;
  signer = await createSigner();
  token = await signer.sign(ownerClaims(NOW));
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await resetDb(env.DB);
  await resetDb(env.RESTORE_DB);
});

describe('sqlLiteral', () => {
  it('quotes strings, keeps each statement on one line, and passes numbers and NULL through', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(12.5)).toBe('12.5');
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral('a\nb')).toBe("'a' || char(10) || 'b'");
    expect(() => sqlLiteral(Number.NaN)).toThrow();
    expect(() => sqlLiteral({})).toThrow();
  });
});

describe('backup worker', () => {
  it('writes a dated SQL file to R2 with row counts', async () => {
    await seed(env.DB);
    const summary = await runBackup({ DB: env.DB, BACKUPS: env.BACKUPS }, new Date(NOW));
    expect(summary.key).toBe('zachtrack-db/2026-10-22.sql');
    expect(summary.rows).toEqual({ fasts: 1, fieldDefinitions: 2, trackableDefinitions: 1, trackableEntries: 3, settings: 1 });

    const object = await env.BACKUPS.get(summary.key);
    expect(object).not.toBeNull();
    expect(object!.customMetadata?.createdAt).toBe(new Date(NOW).toISOString());
    const sql = await object!.text();
    expect(sql.startsWith('-- ZachTrack D1 backup')).toBe(true);
    expect(sql).not.toContain('\r');
  });

  it('restores into an empty database exactly, including tricky text and deletes', async () => {
    await seed(env.DB);
    const { key } = await runBackup({ DB: env.DB, BACKUPS: env.BACKUPS }, new Date(NOW));
    const sql = await (await env.BACKUPS.get(key))!.text();
    await applySql(env.RESTORE_DB, sql);

    for (const table of BACKUP_TABLES) {
      expect(await tableRows(env.RESTORE_DB, table), table).toEqual(await tableRows(env.DB, table));
    }
    const note = await env.RESTORE_DB.prepare('SELECT note FROM trackableEntries WHERE id = ?').bind('e1').first('note');
    expect(note).toBe(trickyNote);
    expect(await env.RESTORE_DB.prepare('SELECT deletedAt FROM trackableEntries WHERE id = ?').bind('e3').first('deletedAt')).toBe(7);
  });

  it('replaces existing rows and gives restored rows a sequence above every device cursor', async () => {
    await seed(env.DB);
    const { key } = await runBackup({ DB: env.DB, BACKUPS: env.BACKUPS }, new Date(NOW));
    const sql = await (await env.BACKUPS.get(key))!.text();

    // The live database moved on after the backup: a new entry and a higher sequence.
    await sync(env.DB, changes({ trackableEntries: [{ id: 'e-later', trackableId: 't-n', timestamp: NOW, createdAt: 9, updatedAt: 9 }] }));
    const deviceCursor = (await sync(env.DB, changes({}))).cursor;

    await applySql(env.DB, sql);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM trackableEntries WHERE id = ?').bind('e-later').first('n')).toBe(0);

    // A device that had already synced past the backup still pulls the restored rows.
    const pulled = await sync(env.DB, { ...changes({}), cursor: deviceCursor });
    expect(pulled.changes.trackableEntries.map((e: { id: string }) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(pulled.changes.fasts).toHaveLength(1);
    expect(pulled.cursor).toBeGreaterThan(deviceCursor);
  });

  it('backs up an empty database without failing', async () => {
    const summary = await runBackup({ DB: env.DB, BACKUPS: env.BACKUPS }, new Date(NOW));
    expect(Object.values(summary.rows).every((n) => n === 0)).toBe(true);
    const sql = await (await env.BACKUPS.get(summary.key))!.text();
    expect(await applySql(env.RESTORE_DB, sql)).toBe(1 + BACKUP_TABLES.length);
  });
});
