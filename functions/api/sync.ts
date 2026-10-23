import type {
  FastRecord,
  FieldDefinition,
  TrackableDefinition,
  TrackableEntry,
  SettingsRecord,
  SyncRecordType,
} from '../../src/lib/db';
import type { AccessDeps } from '../../server/access';
import { jsonResponse, listDevices, refuseUnlessOwner, type DeviceInfo, type Env } from '../../server/endpoint';
import { invalidReason, recordKey, type RecordKind } from '../../src/lib/validate';

export type { Env } from '../../server/endpoint';

/** The device sending a sync, from the app since v1.10.0. Older apps send none. */
export interface SyncDevice {
  id: string;
  name: string;
  appVersion?: string;
}

/** Sync activity and devices not seen for this long are removed. */
export const ACTIVITY_DAYS = 90;
const DAY_MS = 24 * 3600_000;
/** At most this many record names are kept per activity row. */
export const EVENT_DETAILS_LIMIT = 20;

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
  device?: unknown;
  /** Check sync: also return how many live records the server holds. */
  check?: boolean;
}

/** Live (not deleted) records per type on the server, for Check sync. */
export interface ServerCounts {
  fasts: number;
  fieldDefinitions: number;
  trackableDefinitions: number;
  trackableEntries: number;
}

interface RejectedRecord {
  recordType: RecordKind;
  uuid: string;
  reason: string;
}

/** `updatedBy`: the device id that last changed the row, when known. */
type WireRow<T> = T & { deletedAt?: number; updatedBy?: string };

/** A record the server stored from this request: new, newer than its copy, or a delete it applied. */
export interface AppliedRecord {
  recordType: Exclude<RecordKind, 'tombstones'>;
  uuid: string;
  deleted?: boolean;
}

/** At most this many applied records are named in a response; `appliedCounts` always covers all of them. */
export const APPLIED_RECORDS_LIMIT = 50;

interface SyncResponseBody {
  cursor: number;
  /** Changes from other requests since `cursor`. What this request itself stored isn't sent back. */
  changes: {
    fasts: WireRow<FastRecord>[];
    fieldDefinitions: WireRow<FieldDefinition>[];
    trackableDefinitions: WireRow<TrackableDefinition>[];
    trackableEntries: WireRow<TrackableEntry>[];
    settings: WireRow<SettingsRecord> | null;
  };
  rejected: RejectedRecord[];
  /** How many records of each type this request changed on the server; `deletes` counts applied deletes. */
  appliedCounts: Record<Exclude<RecordKind, 'tombstones'> | 'deletes', number>;
  /** The first APPLIED_RECORDS_LIMIT of them, for the device's sync history. */
  applied: AppliedRecord[];
  /** Every device that has synced in the last ACTIVITY_DAYS, most recent first. */
  devices: DeviceInfo[];
  /** Only when the request asked to `check`. */
  counts?: ServerCounts;
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
  const refused = await refuseUnlessOwner(request, env, deps, 'sync');
  if (refused) return refused;

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
  const device = readDevice(body.device);
  const now = (deps.now ?? Date.now)();

  try {
    const { rejected, applied, ownSeq } = await applyIncomingChanges(db, body, device?.id ?? null);
    await recordActivity(db, device, applied, rejected.length, now);
    const changes = await pullChangesSince(db, body.cursor, ownSeq);
    const cursor = await currentSeq(db);

    const appliedCounts: SyncResponseBody['appliedCounts'] = {
      fasts: 0,
      fieldDefinitions: 0,
      trackableDefinitions: 0,
      trackableEntries: 0,
      settings: 0,
      deletes: 0,
    };
    for (const a of applied) appliedCounts[a.deleted ? 'deletes' : a.recordType]++;

    const responseBody: SyncResponseBody = {
      cursor,
      changes,
      rejected,
      appliedCounts,
      applied: applied.slice(0, APPLIED_RECORDS_LIMIT),
      devices: await listDevices(db),
      ...(body.check === true ? { counts: await countLive(db) } : {}),
    };
    return jsonResponse(responseBody);
  } catch (err) {
    // Details go to the Function log (`wrangler pages deployment tail`), not
    // back to the client.
    console.error('sync: failed', err);
    return jsonResponse({ error: 'Sync failed on the server' }, 500);
  }
}

/** The request's device, or null when it's missing or malformed (an app before v1.10.0). */
export function readDevice(raw: unknown): SyncDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(d.id)) return null;
  const name = typeof d.name === 'string' ? d.name.trim().slice(0, 40) : '';
  const appVersion = typeof d.appVersion === 'string' && /^[0-9A-Za-z.+-]{1,20}$/.test(d.appVersion) ? d.appVersion : undefined;
  return { id: d.id, name: name || 'Unnamed device', ...(appVersion ? { appVersion } : {}) };
}

// ---------------------------------------------------------------------------
// Devices and the shared activity log (d1/migrations/0006). A sync that
// changed something gets one syncEvents row with counts and up to 20 record
// names, never values; rows and devices older than ACTIVITY_DAYS go.
// ---------------------------------------------------------------------------

async function recordActivity(
  db: D1Database,
  device: SyncDevice | null,
  applied: AppliedRecord[],
  rejectedCount: number,
  now: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (device) {
    statements.push(
      db
        .prepare(
          `INSERT INTO devices (id, name, appVersion, firstSeenAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, appVersion=excluded.appVersion, lastSeenAt=excluded.lastSeenAt`,
        )
        .bind(device.id, device.name, device.appVersion ?? null, now, now),
    );
  }
  if (applied.length > 0 || rejectedCount > 0) {
    const counts: Record<string, number> = {};
    for (const a of applied) {
      const key = a.deleted ? 'deletes' : a.recordType;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const details = await nameApplied(db, applied.slice(0, EVENT_DETAILS_LIMIT));
    statements.push(
      db
        .prepare('INSERT INTO syncEvents (deviceId, at, counts, details, rejectedCount) VALUES (?, ?, ?, ?, ?)')
        .bind(device?.id ?? 'unknown', now, JSON.stringify(counts), JSON.stringify(details), rejectedCount),
    );
  }
  const cutoff = now - ACTIVITY_DAYS * DAY_MS;
  statements.push(db.prepare('DELETE FROM syncEvents WHERE at < ?').bind(cutoff));
  statements.push(db.prepare('DELETE FROM devices WHERE lastSeenAt < ?').bind(cutoff));
  await db.batch(statements);
}

const KIND_LABEL: Record<AppliedRecord['recordType'], string> = {
  fasts: 'Fast',
  fieldDefinitions: 'Field',
  trackableDefinitions: 'Trackable',
  trackableEntries: 'Entry',
  settings: 'Settings',
};

/** "Entry -- Water", "Trackable deleted -- Reading", "Fast": the kind and a name, never a value. */
async function nameApplied(db: D1Database, applied: AppliedRecord[]): Promise<string[]> {
  const idsOf = (type: AppliedRecord['recordType']) => applied.filter((a) => a.recordType === type).map((a) => a.uuid);
  const marks = (n: number) => Array(n).fill('?').join(', ');
  const lookups: Array<{ type: AppliedRecord['recordType']; statement: D1PreparedStatement }> = [];
  const entryIds = idsOf('trackableEntries');
  if (entryIds.length) {
    lookups.push({
      type: 'trackableEntries',
      statement: db
        .prepare(
          `SELECT e.id AS id, t.name AS name FROM trackableEntries e LEFT JOIN trackableDefinitions t ON t.id = e.trackableId WHERE e.id IN (${marks(entryIds.length)})`,
        )
        .bind(...entryIds),
    });
  }
  for (const type of ['fieldDefinitions', 'trackableDefinitions'] as const) {
    const ids = idsOf(type);
    if (ids.length) lookups.push({ type, statement: db.prepare(`SELECT id, name FROM ${type} WHERE id IN (${marks(ids.length)})`).bind(...ids) });
  }
  const names = new Map<string, string>();
  if (lookups.length) {
    const results = await db.batch<{ id: string; name: string | null }>(lookups.map((l) => l.statement));
    results.forEach((r, i) => {
      for (const row of r.results ?? []) if (row.name) names.set(`${lookups[i].type}:${row.id}`, row.name);
    });
  }
  return applied.map((a) => {
    const head = a.deleted ? `${KIND_LABEL[a.recordType]} deleted` : KIND_LABEL[a.recordType];
    const name = names.get(`${a.recordType}:${a.uuid}`);
    return name ? `${head} -- ${name}` : head;
  });
}

async function countLive(db: D1Database): Promise<ServerCounts> {
  const tables = ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries'] as const;
  const results = await db.batch<{ n: number }>(tables.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE deletedAt IS NULL`)));
  const counts = {} as ServerCounts;
  tables.forEach((t, i) => (counts[t] = results[i].results?.[0]?.n ?? 0));
  return counts;
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

interface ApplyResult {
  rejected: RejectedRecord[];
  /** Records a statement actually changed (D1's `meta.changes`), so a same-age or older copy isn't counted. */
  applied: AppliedRecord[];
  /** The serverSeq block reserved for this request, [first, last]; the pull leaves these rows out. */
  ownSeq: [number, number] | null;
}

/** Runs one batch and records which of its statements changed a row. */
async function runBatch(db: D1Database, items: Array<{ statement: D1PreparedStatement; record: AppliedRecord }>, applied: AppliedRecord[]) {
  if (items.length === 0) return;
  const results = await db.batch(items.map((i) => i.statement));
  results.forEach((result, i) => {
    if ((result.meta?.changes ?? 0) > 0) applied.push(items[i].record);
  });
}

async function applyIncomingChanges(db: D1Database, body: SyncRequestBody, updatedBy: string | null): Promise<ApplyResult> {
  const rejected: RejectedRecord[] = [];
  const applied: AppliedRecord[] = [];

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
  let ownSeq: ApplyResult['ownSeq'] = null;
  if (totalSeqNeeded > 0) {
    const row = await db
      .prepare('UPDATE syncSeq SET value = value + ? WHERE id = 1 RETURNING value')
      .bind(totalSeqNeeded)
      .first<{ value: number }>();
    const endValue = row!.value;
    nextSeqValue = endValue - totalSeqNeeded + 1;
    ownSeq = [nextSeqValue, endValue];
  }
  const takeSeq = (): number => nextSeqValue++;

  // --- fasts: resolve one-fast-per-day conflicts in memory before batching ---
  const fastStatements: Array<{ statement: D1PreparedStatement; record: AppliedRecord }> = [];
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
      fastStatements.push({ statement: buildFastUpsert(db, fast, takeSeq(), updatedBy), record: { recordType: 'fasts', uuid: fast.uuid } });
    }
  }
  await runBatch(db, fastStatements, applied);

  // --- fieldDefinitions / trackableDefinitions / trackableEntries / settings ---
  await runBatch(
    db,
    fields.map((f) => ({ statement: buildFieldUpsert(db, f, takeSeq(), updatedBy), record: { recordType: 'fieldDefinitions' as const, uuid: f.id } })),
    applied,
  );
  await runBatch(
    db,
    trackables.map((t) => ({
      statement: buildTrackableUpsert(db, t, takeSeq(), updatedBy),
      record: { recordType: 'trackableDefinitions' as const, uuid: t.id },
    })),
    applied,
  );
  await runBatch(
    db,
    entries.map((e) => ({ statement: buildEntryUpsert(db, e, takeSeq(), updatedBy), record: { recordType: 'trackableEntries' as const, uuid: e.id } })),
    applied,
  );
  if (settings) {
    await runBatch(db, [{ statement: buildSettingsUpsert(db, settings, takeSeq(), updatedBy), record: { recordType: 'settings', uuid: settings.id } }], applied);
  }

  // --- tombstones (soft deletes), LWW-aware ---
  const deletes: Array<{ statement: D1PreparedStatement; record: AppliedRecord }> = [];
  for (const t of tombstones) {
    const statement = buildTombstoneUpdate(db, t, takeSeq(), updatedBy);
    if (statement) deletes.push({ statement, record: { recordType: t.recordType, uuid: t.uuid, deleted: true } });
  }
  await runBatch(db, deletes, applied);

  return { rejected, applied, ownSeq };
}

// ---------------------------------------------------------------------------
// Statement builders (last-write-wins via `WHERE excluded.updatedAt > ...`,
// so no separate pre-check SELECT is needed per record)
// ---------------------------------------------------------------------------

function buildFastUpsert(db: D1Database, fast: FastRecord, serverSeq: number, updatedBy: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fasts (uuid, startTime, startDay, endTime, method, presetId, presetLabel, targetHours, moodRating, energyRating, hungerRating, tags, note, createdAt, updatedAt, deletedAt, serverSeq, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         startTime=excluded.startTime, startDay=excluded.startDay, endTime=excluded.endTime,
         method=excluded.method, presetId=excluded.presetId, presetLabel=excluded.presetLabel,
         targetHours=excluded.targetHours, moodRating=excluded.moodRating, energyRating=excluded.energyRating,
         hungerRating=excluded.hungerRating, tags=excluded.tags, note=excluded.note,
         createdAt=excluded.createdAt, updatedAt=excluded.updatedAt, deletedAt=NULL, serverSeq=excluded.serverSeq, updatedBy=excluded.updatedBy
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
      updatedBy,
    );
}

function buildFieldUpsert(db: D1Database, field: FieldDefinition, serverSeq: number, updatedBy: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fieldDefinitions (id, name, kind, unit, ratingMin, ratingMax, aggregation, createdAt, updatedAt, deletedAt, serverSeq, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, kind=excluded.kind, unit=excluded.unit, ratingMin=excluded.ratingMin,
         ratingMax=excluded.ratingMax, aggregation=excluded.aggregation, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq, updatedBy=excluded.updatedBy
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
      updatedBy,
    );
}

function buildTrackableUpsert(db: D1Database, trackable: TrackableDefinition, serverSeq: number, updatedBy: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO trackableDefinitions (id, name, icon, color, fieldIds, displayMode, goalType, goalValue, pinned, archived, sortOrder,
         scheduleDays, skipDays, pausedUntil, dateKind, dateLeadDays, createdAt, updatedAt, deletedAt, serverSeq, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, icon=excluded.icon, color=excluded.color, fieldIds=excluded.fieldIds,
         displayMode=excluded.displayMode, goalType=excluded.goalType, goalValue=excluded.goalValue,
         pinned=excluded.pinned, archived=excluded.archived, sortOrder=excluded.sortOrder,
         scheduleDays=excluded.scheduleDays, skipDays=excluded.skipDays, pausedUntil=excluded.pausedUntil,
         dateKind=excluded.dateKind, dateLeadDays=excluded.dateLeadDays,
         createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq, updatedBy=excluded.updatedBy
       WHERE excluded.updatedAt > trackableDefinitions.updatedAt`,
    )
    .bind(
      trackable.id,
      trackable.name,
      trackable.icon,
      trackable.color,
      JSON.stringify(trackable.fieldIds ?? []),
      trackable.displayMode ?? null,
      trackable.goalType ?? null,
      trackable.goalValue ?? null,
      trackable.pinned == null ? null : trackable.pinned ? 1 : 0,
      trackable.archived == null ? null : trackable.archived ? 1 : 0,
      trackable.sortOrder ?? null,
      trackable.scheduleDays ? JSON.stringify(trackable.scheduleDays) : null,
      trackable.skipDays ? JSON.stringify(trackable.skipDays) : null,
      trackable.pausedUntil ?? null,
      trackable.dateKind ?? null,
      trackable.dateLeadDays ?? null,
      trackable.createdAt,
      trackable.updatedAt,
      serverSeq,
      updatedBy,
    );
}

function buildEntryUpsert(db: D1Database, entry: TrackableEntry, serverSeq: number, updatedBy: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO trackableEntries (id, trackableId, timestamp, note, tags, fieldValues, dateRepeat, createdAt, updatedAt, deletedAt, serverSeq, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         trackableId=excluded.trackableId, timestamp=excluded.timestamp, note=excluded.note, tags=excluded.tags,
         fieldValues=excluded.fieldValues, dateRepeat=excluded.dateRepeat, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt,
         deletedAt=NULL, serverSeq=excluded.serverSeq, updatedBy=excluded.updatedBy
       WHERE excluded.updatedAt > trackableEntries.updatedAt`,
    )
    .bind(
      entry.id,
      entry.trackableId,
      entry.timestamp,
      entry.note ?? null,
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.values ? JSON.stringify(entry.values) : null,
      entry.dateRepeat ? JSON.stringify(entry.dateRepeat) : null,
      entry.createdAt,
      entry.updatedAt,
      serverSeq,
      updatedBy,
    );
}

function buildSettingsUpsert(db: D1Database, settings: SettingsRecord, serverSeq: number, updatedBy: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO settings (id, defaultPresetId, notificationsEnabled, heightInches, goalWeightLb, weightFieldId,
         waistFieldId, neckFieldId, hipFieldId, bodyFatSex, fastScheduleTime, customFastPresets, fastWeekPlan, updatedAt, serverSeq, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         defaultPresetId=excluded.defaultPresetId, notificationsEnabled=excluded.notificationsEnabled,
         heightInches=excluded.heightInches, goalWeightLb=excluded.goalWeightLb, weightFieldId=excluded.weightFieldId,
         waistFieldId=excluded.waistFieldId, neckFieldId=excluded.neckFieldId, hipFieldId=excluded.hipFieldId,
         bodyFatSex=excluded.bodyFatSex, fastScheduleTime=excluded.fastScheduleTime,
         customFastPresets=excluded.customFastPresets, fastWeekPlan=excluded.fastWeekPlan,
         updatedAt=excluded.updatedAt, serverSeq=excluded.serverSeq, updatedBy=excluded.updatedBy
       WHERE excluded.updatedAt > settings.updatedAt`,
    )
    .bind(
      settings.id,
      settings.defaultPresetId,
      settings.notificationsEnabled ? 1 : 0,
      settings.heightInches ?? null,
      settings.goalWeightLb ?? null,
      settings.weightFieldId ?? null,
      settings.waistFieldId ?? null,
      settings.neckFieldId ?? null,
      settings.hipFieldId ?? null,
      settings.bodyFatSex ?? null,
      settings.fastScheduleTime ?? null,
      settings.customFastPresets ? JSON.stringify(settings.customFastPresets) : null,
      settings.fastWeekPlan ? JSON.stringify(settings.fastWeekPlan) : null,
      settings.updatedAt,
      serverSeq,
      updatedBy,
    );
}

function buildTombstoneUpdate(db: D1Database, tombstone: Tombstone, serverSeq: number, updatedBy: string | null): D1PreparedStatement | null {
  if (!Object.hasOwn(TOMBSTONE_TABLES, tombstone.recordType) || !tombstone.uuid) return null;
  const target = TOMBSTONE_TABLES[tombstone.recordType];
  // Only apply if the current row's updatedAt doesn't postdate this delete
  // (i.e. no newer concurrent edit from another device has superseded it).
  // The row itself stays (other devices learn about the delete from it), but
  // its health content is cleared so a deleted entry doesn't keep its values.
  return db
    .prepare(
      `UPDATE ${target.table} SET ${target.scrub ? `${target.scrub}, ` : ''}deletedAt = ?, updatedAt = ?, serverSeq = ?, updatedBy = ? WHERE ${target.keyColumn} = ? AND updatedAt <= ?`,
    )
    .bind(tombstone.deletedAt, tombstone.deletedAt, serverSeq, updatedBy, tombstone.uuid, tombstone.deletedAt);
}

// ---------------------------------------------------------------------------
// Pull: everything changed server-side since the client's cursor, except the
// rows this request wrote itself (the device already has them). A row another
// device changed after this request wrote it has a newer serverSeq, so it
// still comes through.
// ---------------------------------------------------------------------------

async function pullChangesSince(db: D1Database, cursor: number, ownSeq: [number, number] | null): Promise<SyncResponseBody['changes']> {
  const [first, last] = ownSeq ?? [0, -1]; // an empty range leaves nothing out
  const since = (table: string) =>
    db.prepare(`SELECT * FROM ${table} WHERE serverSeq > ? AND serverSeq NOT BETWEEN ? AND ?`).bind(cursor, first, last).all();
  const [fastsRes, fieldsRes, trackablesRes, entriesRes, settingsRes] = await Promise.all([
    since('fasts'),
    since('fieldDefinitions'),
    since('trackableDefinitions'),
    since('trackableEntries'),
    since('settings'),
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
    updatedBy: (row.updatedBy as string) ?? undefined,
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
    updatedBy: (row.updatedBy as string) ?? undefined,
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
    goalType: (row.goalType as TrackableDefinition['goalType']) ?? undefined,
    goalValue: (row.goalValue as number) ?? undefined,
    pinned: row.pinned == null ? undefined : Boolean(row.pinned),
    archived: row.archived == null ? undefined : Boolean(row.archived),
    sortOrder: (row.sortOrder as number) ?? undefined,
    scheduleDays: row.scheduleDays ? JSON.parse(row.scheduleDays as string) : undefined,
    skipDays: row.skipDays ? JSON.parse(row.skipDays as string) : undefined,
    pausedUntil: (row.pausedUntil as number) ?? undefined,
    dateKind: (row.dateKind as TrackableDefinition['dateKind']) ?? undefined,
    dateLeadDays: (row.dateLeadDays as number) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
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
    dateRepeat: row.dateRepeat ? JSON.parse(row.dateRepeat as string) : undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

function mapSettingsRow(row: Record<string, unknown>): WireRow<SettingsRecord> {
  return {
    id: 'app-settings',
    defaultPresetId: row.defaultPresetId as string,
    notificationsEnabled: Boolean(row.notificationsEnabled),
    heightInches: (row.heightInches as number) ?? undefined,
    goalWeightLb: (row.goalWeightLb as number) ?? undefined,
    weightFieldId: (row.weightFieldId as string) ?? undefined,
    waistFieldId: (row.waistFieldId as string) ?? undefined,
    neckFieldId: (row.neckFieldId as string) ?? undefined,
    hipFieldId: (row.hipFieldId as string) ?? undefined,
    bodyFatSex: (row.bodyFatSex as SettingsRecord['bodyFatSex']) ?? undefined,
    fastScheduleTime: (row.fastScheduleTime as string) ?? undefined,
    customFastPresets: row.customFastPresets ? JSON.parse(row.customFastPresets as string) : undefined,
    fastWeekPlan: row.fastWeekPlan ? JSON.parse(row.fastWeekPlan as string) : undefined,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}
