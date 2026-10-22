import type {
  FastRecord,
  FieldDefinition,
  TrackableDefinition,
  TrackableEntry,
  SettingsRecord,
  SyncRecordType,
} from '../../src/lib/db';
import { UNAVAILABLE_REASONS, verifyAccessJwt, type AccessDeps } from '../../server/access';
import { invalidReason, recordKey, type RecordKind } from '../../src/lib/validate';

export interface Env {
  DB: D1Database;
  /** The only email allowed to sync. Required: the endpoint refuses every request without it. */
  OWNER_EMAIL?: string;
  /** Zero Trust team domain (`your-team.cloudflareaccess.com`). Required. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. Optional, checked when set. */
  ACCESS_AUD?: string;
}

interface Tombstone {
  recordType: SyncRecordType;
  uuid: string;
  deletedAt: number;
}

interface SyncRequestBody {
  cursor: number;
  changes: {
    fasts: FastRecord[];
    fieldDefinitions: FieldDefinition[];
    trackableDefinitions: TrackableDefinition[];
    trackableEntries: TrackableEntry[];
    settings: SettingsRecord | null;
  };
  tombstones: Tombstone[];
}

interface RejectedRecord {
  recordType: RecordKind;
  uuid: string;
  reason: string;
}

type WireRow<T> = T & { deletedAt?: number };

interface SyncResponseBody {
  cursor: number;
  changes: {
    fasts: WireRow<FastRecord>[];
    fieldDefinitions: WireRow<FieldDefinition>[];
    trackableDefinitions: WireRow<TrackableDefinition>[];
    trackableEntries: WireRow<TrackableEntry>[];
    settings: WireRow<SettingsRecord> | null;
  };
  rejected: RejectedRecord[];
}

/**
 * Where each record type lives, and which columns a delete clears. Field and
 * trackable definitions keep their names so the sync history can still say
 * what was deleted; fasts and entries lose their notes, tags and values.
 * d1/scrub-deleted.sql applies the same clearing to rows deleted earlier.
 */
const TOMBSTONE_TABLES: Record<SyncRecordType, { table: string; keyColumn: string; scrub?: string }> = {
  fasts: {
    table: 'fasts',
    keyColumn: 'uuid',
    scrub: 'note = NULL, tags = NULL, moodRating = NULL, energyRating = NULL, hungerRating = NULL',
  },
  fieldDefinitions: { table: 'fieldDefinitions', keyColumn: 'id' },
  trackableDefinitions: { table: 'trackableDefinitions', keyColumn: 'id' },
  trackableEntries: { table: 'trackableEntries', keyColumn: 'id', scrub: 'note = NULL, tags = NULL, fieldValues = NULL' },
};

export const onRequestPost: PagesFunction<Env> = (context) => handleSync(context.request, context.env);

/** The sync handler, separate from the Pages export so tests can inject Access key fetching and time. */
export async function handleSync(request: Request, env: Env, deps: AccessDeps = {}): Promise<Response> {
  // Cloudflare Access gates the custom domain before this Function runs, but
  // `<project>.pages.dev` and per-deployment aliases can reach it without
  // Access. So the Access JWT is verified here, and a missing owner or team
  // domain fails closed instead of skipping the check.
  if (!env.OWNER_EMAIL || !env.ACCESS_TEAM_DOMAIN) {
    console.error('sync: OWNER_EMAIL and ACCESS_TEAM_DOMAIN must both be set');
    return jsonResponse({ error: 'Sync is not configured on the server' }, 503);
  }
  const access = await verifyAccessJwt(
    request.headers.get('Cf-Access-Jwt-Assertion'),
    { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL },
    deps,
  );
  if (!access.ok) {
    if (UNAVAILABLE_REASONS.has(access.reason)) {
      console.error(`sync: could not check the Access token (${access.reason})`);
      return jsonResponse({ error: 'Sync is temporarily unavailable' }, 503);
    }
    console.warn(`sync: rejected request (${access.reason})`);
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  let body: SyncRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body?.cursor !== 'number' || !Number.isFinite(body.cursor) || typeof body.changes !== 'object' || body.changes === null) {
    return jsonResponse({ error: 'Malformed sync request' }, 400);
  }

  const db = env.DB;

  try {
    const rejected = await applyIncomingChanges(db, body);
    const changes = await pullChangesSince(db, body.cursor);
    const cursor = await currentSeq(db);

    const responseBody: SyncResponseBody = { cursor, changes, rejected };
    return jsonResponse(responseBody);
  } catch (err) {
    // Details go to the Function log (`wrangler pages deployment tail`), not
    // back to the client.
    console.error('sync: failed', err);
    return jsonResponse({ error: 'Sync failed on the server' }, 500);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Health data: never cached by the browser or anything in between.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function currentSeq(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT value FROM syncSeq WHERE id = 1').first<{ value: number }>();
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Apply incoming changes -- batched to stay well under Cloudflare's
// per-request subrequest limit (50 on the free plan) regardless of how many
// records are being synced. Every write path here is at most a small,
// fixed number of round trips to D1:
//   1. reserve a contiguous block of `serverSeq` values (1 query)
//   2. fasts-only: fetch current (startDay -> uuid) claims for conflict
//      detection (1 query)
//   3. up to 5 batched upserts (one batch call per table)
//   4. up to 1 batched tombstone application (all deletes together)
// ---------------------------------------------------------------------------

async function applyIncomingChanges(db: D1Database, body: SyncRequestBody): Promise<RejectedRecord[]> {
  const rejected: RejectedRecord[] = [];

  // Drop (and report) anything that doesn't match the schema before any SQL
  // runs, so one bad record can't fail a whole batch (see src/lib/validate.ts).
  function valid<T>(kind: RecordKind, list: unknown): T[] {
    if (list == null) return [];
    if (!Array.isArray(list)) {
      rejected.push({ recordType: kind, uuid: '', reason: `${kind} must be a list` });
      return [];
    }
    return list.filter((record): record is T => {
      const reason = invalidReason(kind, record);
      if (reason) rejected.push({ recordType: kind, uuid: recordKey(record), reason: `Invalid record: ${reason}` });
      return reason === null;
    });
  }

  const fasts = valid<FastRecord>('fasts', body.changes.fasts);
  const fields = valid<FieldDefinition>('fieldDefinitions', body.changes.fieldDefinitions);
  const trackables = valid<TrackableDefinition>('trackableDefinitions', body.changes.trackableDefinitions);
  const entries = valid<TrackableEntry>('trackableEntries', body.changes.trackableEntries);
  const settings = body.changes.settings == null ? null : (valid<SettingsRecord>('settings', [body.changes.settings])[0] ?? null);
  const tombstones = valid<Tombstone>('tombstones', body.tombstones);

  const totalSeqNeeded = fasts.length + fields.length + trackables.length + entries.length + (settings ? 1 : 0) + tombstones.length;
  let nextSeqValue = 0;
  if (totalSeqNeeded > 0) {
    const row = await db
      .prepare('UPDATE syncSeq SET value = value + ? WHERE id = 1 RETURNING value')
      .bind(totalSeqNeeded)
      .first<{ value: number }>();
    const endValue = row!.value;
    nextSeqValue = endValue - totalSeqNeeded + 1;
  }
  const takeSeq = (): number => nextSeqValue++;

  // --- fasts: resolve one-fast-per-day conflicts in memory before batching ---
  const fastStatements: D1PreparedStatement[] = [];
  if (fasts.length > 0) {
    const claims = await db
      .prepare('SELECT uuid, startDay FROM fasts WHERE deletedAt IS NULL')
      .all<{ uuid: string; startDay: number }>();
    const startDayOwner = new Map<number, string>();
    for (const row of claims.results ?? []) startDayOwner.set(row.startDay, row.uuid);

    for (const fast of fasts) {
      if (!fast.uuid) continue;
      const owner = startDayOwner.get(fast.startDay);
      if (owner && owner !== fast.uuid) {
        rejected.push({
          recordType: 'fasts',
          uuid: fast.uuid,
          reason: 'Another fast already starts on this day (conflicts with a fast synced from another device).',
        });
        continue;
      }
      startDayOwner.set(fast.startDay, fast.uuid);
      fastStatements.push(buildFastUpsert(db, fast, takeSeq()));
    }
  }
  if (fastStatements.length > 0) await db.batch(fastStatements);

  // --- fieldDefinitions / trackableDefinitions / trackableEntries / settings ---
  if (fields.length > 0) {
    await db.batch(fields.map((f) => buildFieldUpsert(db, f, takeSeq())));
  }
  if (trackables.length > 0) {
    await db.batch(trackables.map((t) => buildTrackableUpsert(db, t, takeSeq())));
  }
  if (entries.length > 0) {
    await db.batch(entries.map((e) => buildEntryUpsert(db, e, takeSeq())));
  }
  if (settings) {
    await db.batch([buildSettingsUpsert(db, settings, takeSeq())]);
  }

  // --- tombstones (soft deletes), LWW-aware ---
  if (tombstones.length > 0) {
    const statements = tombstones
      .map((t) => buildTombstoneUpdate(db, t, takeSeq()))
      .filter((s): s is D1PreparedStatement => s != null);
    if (statements.length > 0) await db.batch(statements);
  }

  return rejected;
}

// ---------------------------------------------------------------------------
// Statement builders (last-write-wins via `WHERE excluded.updatedAt > ...`,
// so no separate pre-check SELECT is needed per record)
// ---------------------------------------------------------------------------

function buildFastUpsert(db: D1Database, fast: FastRecord, serverSeq: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fasts (uuid, startTime, startDay, endTime, method, presetId, presetLabel, targetHours, moodRating, energyRating, hungerRating, tags, note, createdAt, updatedAt, deletedAt, serverSeq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         startTime=excluded.startTime, startDay=excluded.startDay, endTime=excluded.endTime,
         method=excluded.method, presetId=excluded.presetId, presetLabel=excluded.presetLabel,
         targetHours=excluded.targetHours, moodRating=excluded.moodRating, energyRating=excluded.energyRating,
         hungerRating=excluded.hungerRating, tags=excluded.tags, note=excluded.note,
         createdAt=excluded.createdAt, updatedAt=excluded.updatedAt, deletedAt=NULL, serverSeq=excluded.serverSeq
       WHERE excluded.updatedAt > fasts.updatedAt`,
    )
    .bind(
      fast.uuid,
      fast.startTime,
      fast.startDay,
      fast.endTime ?? null,
      fast.method,
      fast.presetId ?? null,
      fast.presetLabel ?? null,
      fast.targetHours ?? null,
      fast.moodRating ?? null,
      fast.energyRating ?? null,
      fast.hungerRating ?? null,
      fast.tags ? JSON.stringify(fast.tags) : null,
      fast.note ?? null,
      fast.createdAt,
      fast.updatedAt,
      serverSeq,
    );
}

function buildFieldUpsert(db: D1Database, field: FieldDefinition, serverSeq: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fieldDefinitions (id, name, kind, unit, ratingMin, ratingMax, aggregation, createdAt, updatedAt, deletedAt, serverSeq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, kind=excluded.kind, unit=excluded.unit, ratingMin=excluded.ratingMin,
         ratingMax=excluded.ratingMax, aggregation=excluded.aggregation, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq
       WHERE excluded.updatedAt > fieldDefinitions.updatedAt`,
    )
    .bind(
      field.id,
      field.name,
      field.kind,
      field.unit ?? null,
      field.ratingMin ?? null,
      field.ratingMax ?? null,
      field.aggregation ?? null,
      field.createdAt,
      field.updatedAt,
      serverSeq,
    );
}

function buildTrackableUpsert(db: D1Database, trackable: TrackableDefinition, serverSeq: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO trackableDefinitions (id, name, icon, color, fieldIds, displayMode, createdAt, updatedAt, deletedAt, serverSeq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, icon=excluded.icon, color=excluded.color, fieldIds=excluded.fieldIds,
         displayMode=excluded.displayMode, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq
       WHERE excluded.updatedAt > trackableDefinitions.updatedAt`,
    )
    .bind(
      trackable.id,
      trackable.name,
      trackable.icon,
      trackable.color,
      JSON.stringify(trackable.fieldIds ?? []),
      trackable.displayMode ?? null,
      trackable.createdAt,
      trackable.updatedAt,
      serverSeq,
    );
}

function buildEntryUpsert(db: D1Database, entry: TrackableEntry, serverSeq: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO trackableEntries (id, trackableId, timestamp, note, tags, fieldValues, createdAt, updatedAt, deletedAt, serverSeq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         trackableId=excluded.trackableId, timestamp=excluded.timestamp, note=excluded.note, tags=excluded.tags,
         fieldValues=excluded.fieldValues, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq
       WHERE excluded.updatedAt > trackableEntries.updatedAt`,
    )
    .bind(
      entry.id,
      entry.trackableId,
      entry.timestamp,
      entry.note ?? null,
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.values ? JSON.stringify(entry.values) : null,
      entry.createdAt,
      entry.updatedAt,
      serverSeq,
    );
}

function buildSettingsUpsert(db: D1Database, settings: SettingsRecord, serverSeq: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO settings (id, defaultPresetId, notificationsEnabled, heightInches, goalWeightLb, updatedAt, serverSeq)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         defaultPresetId=excluded.defaultPresetId, notificationsEnabled=excluded.notificationsEnabled,
         heightInches=excluded.heightInches, goalWeightLb=excluded.goalWeightLb,
         updatedAt=excluded.updatedAt, serverSeq=excluded.serverSeq
       WHERE excluded.updatedAt > settings.updatedAt`,
    )
    .bind(
      settings.id,
      settings.defaultPresetId,
      settings.notificationsEnabled ? 1 : 0,
      settings.heightInches ?? null,
      settings.goalWeightLb ?? null,
      settings.updatedAt,
      serverSeq,
    );
}

function buildTombstoneUpdate(db: D1Database, tombstone: Tombstone, serverSeq: number): D1PreparedStatement | null {
  if (!Object.hasOwn(TOMBSTONE_TABLES, tombstone.recordType) || !tombstone.uuid) return null;
  const target = TOMBSTONE_TABLES[tombstone.recordType];
  // Only apply if the current row's updatedAt doesn't postdate this delete
  // (i.e. no newer concurrent edit from another device has superseded it).
  // The row itself stays (other devices learn about the delete from it), but
  // its health content is cleared so a deleted entry doesn't keep its values.
  return db
    .prepare(
      `UPDATE ${target.table} SET ${target.scrub ? `${target.scrub}, ` : ''}deletedAt = ?, updatedAt = ?, serverSeq = ? WHERE ${target.keyColumn} = ? AND updatedAt <= ?`,
    )
    .bind(tombstone.deletedAt, tombstone.deletedAt, serverSeq, tombstone.uuid, tombstone.deletedAt);
}

// ---------------------------------------------------------------------------
// Pull: everything changed server-side since the client's cursor
// ---------------------------------------------------------------------------

async function pullChangesSince(db: D1Database, cursor: number): Promise<SyncResponseBody['changes']> {
  const [fastsRes, fieldsRes, trackablesRes, entriesRes, settingsRes] = await Promise.all([
    db.prepare('SELECT * FROM fasts WHERE serverSeq > ?').bind(cursor).all(),
    db.prepare('SELECT * FROM fieldDefinitions WHERE serverSeq > ?').bind(cursor).all(),
    db.prepare('SELECT * FROM trackableDefinitions WHERE serverSeq > ?').bind(cursor).all(),
    db.prepare('SELECT * FROM trackableEntries WHERE serverSeq > ?').bind(cursor).all(),
    db.prepare('SELECT * FROM settings WHERE serverSeq > ?').bind(cursor).all(),
  ]);

  return {
    fasts: fastsRes.results.map((row) => mapFastRow(row as Record<string, unknown>)),
    fieldDefinitions: fieldsRes.results.map((row) => mapFieldRow(row as Record<string, unknown>)),
    trackableDefinitions: trackablesRes.results.map((row) => mapTrackableRow(row as Record<string, unknown>)),
    trackableEntries: entriesRes.results.map((row) => mapEntryRow(row as Record<string, unknown>)),
    settings: settingsRes.results[0] ? mapSettingsRow(settingsRes.results[0] as Record<string, unknown>) : null,
  };
}

function mapFastRow(row: Record<string, unknown>): WireRow<FastRecord> {
  return {
    uuid: row.uuid as string,
    startTime: row.startTime as number,
    startDay: row.startDay as number,
    endTime: (row.endTime as number) ?? undefined,
    method: row.method as FastRecord['method'],
    presetId: (row.presetId as string) ?? undefined,
    presetLabel: (row.presetLabel as string) ?? undefined,
    targetHours: (row.targetHours as number) ?? undefined,
    moodRating: (row.moodRating as number) ?? undefined,
    energyRating: (row.energyRating as number) ?? undefined,
    hungerRating: (row.hungerRating as number) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    note: (row.note as string) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
  };
}

function mapFieldRow(row: Record<string, unknown>): WireRow<FieldDefinition> {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as FieldDefinition['kind'],
    unit: (row.unit as string) ?? undefined,
    ratingMin: (row.ratingMin as number) ?? undefined,
    ratingMax: (row.ratingMax as number) ?? undefined,
    aggregation: (row.aggregation as FieldDefinition['aggregation']) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
  };
}

function mapTrackableRow(row: Record<string, unknown>): WireRow<TrackableDefinition> {
  return {
    id: row.id as string,
    name: row.name as string,
    icon: row.icon as string,
    color: row.color as string,
    fieldIds: row.fieldIds ? JSON.parse(row.fieldIds as string) : [],
    displayMode: (row.displayMode as TrackableDefinition['displayMode']) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
  };
}

function mapEntryRow(row: Record<string, unknown>): WireRow<TrackableEntry> {
  return {
    id: row.id as string,
    trackableId: row.trackableId as string,
    timestamp: row.timestamp as number,
    note: (row.note as string) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    values: row.fieldValues ? JSON.parse(row.fieldValues as string) : undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
  };
}

function mapSettingsRow(row: Record<string, unknown>): WireRow<SettingsRecord> {
  return {
    id: 'app-settings',
    defaultPresetId: row.defaultPresetId as string,
    notificationsEnabled: Boolean(row.notificationsEnabled),
    heightInches: (row.heightInches as number) ?? undefined,
    goalWeightLb: (row.goalWeightLb as number) ?? undefined,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
  };
}
