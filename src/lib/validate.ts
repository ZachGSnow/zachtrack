// Shape checks for records arriving at /api/sync, also used to check an
// imported export file before anything is written (src/lib/dataFile.ts).
//
// D1 rejects a whole `db.batch()` when one statement fails (a NOT NULL
// column bound to undefined, say), so one malformed record from a client bug
// would make every later sync fail. Each record is checked here first;
// anything that doesn't match d1/schema.sql is left out of the batch and
// reported back in the response's `rejected` list, like a day conflict.
// Extra properties (e.g. Dexie's local `id` on fasts) are allowed and ignored.

export type RecordKind =
  | 'fasts'
  | 'fieldDefinitions'
  | 'trackableDefinitions'
  | 'trackableEntries'
  | 'taskProjects'
  | 'tasks'
  | 'taskCompletions'
  | 'settings'
  | 'tombstones';

/** Longest string accepted in any text column (notes, names, tags). */
export const MAX_TEXT = 10_000;
const MAX_TAGS = 100;
const MAX_FIELD_IDS = 200;
const MAX_VALUES = 200;
const MAX_SECTIONS = 200;
const MAX_SUBTASK_IDS = 500;

type Check = (record: Record<string, unknown>) => string | null;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** A DateRepeat (db.ts), with no keys beyond its type's. */
function isDateRepeat(v: unknown): boolean {
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (v.type) {
    case 'yearly':
    case 'once':
      return only('type');
    case 'every':
      return only('type', 'count', 'unit') && isInt(v.count, 1, 100) && (v.unit === 'months' || v.unit === 'years');
    case 'nthWeekday':
      return only('type', 'month', 'weekday', 'nth') && isInt(v.month, 0, 11) && isInt(v.weekday, 0, 6) && (isInt(v.nth, 1, 5) || v.nth === -1);
    case 'easter':
      return only('type', 'offsetDays') && (v.offsetDays === undefined || isInt(v.offsetDays, -100, 100));
    default:
      return false;
  }
}
/** A TaskRepeat (db.ts), with no keys beyond its type's. */
function isTaskRepeat(v: unknown): boolean {
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  if (!isInt(v.every, 1, 365)) return false;
  switch (v.type) {
    case 'days':
    case 'years':
      return only('type', 'every');
    case 'weeks':
      return (
        only('type', 'every', 'weekdays') &&
        Array.isArray(v.weekdays) &&
        v.weekdays.length >= 1 &&
        v.weekdays.length <= 7 &&
        v.weekdays.every((d) => isInt(d, 0, 6)) &&
        new Set(v.weekdays).size === v.weekdays.length
      );
    case 'months':
      return only('type', 'every', 'day') && (isInt(v.day, 1, 31) || v.day === -1);
    case 'monthsNth':
      return only('type', 'every', 'nth', 'weekday') && (isInt(v.nth, 1, 5) || v.nth === -1) && isInt(v.weekday, 0, 6);
    case 'afterDone':
      return only('type', 'every', 'unit') && ['days', 'weeks', 'months', 'years'].includes(v.unit as string);
    default:
      return false;
  }
}

/** A real calendar day as "YYYY-MM-DD". */
function isDay(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isClock = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * How far ahead of the server's (or this device's) clock a change time may
 * be. Last write wins on `updatedAt`, so a time far in the future (a clock set
 * wrong, a hand-made file) would beat every later edit forever, and a delete
 * stamped in the future would beat them too.
 */
export const MAX_CLOCK_AHEAD_MS = 24 * 3600_000;
const isChangeTime = (v: unknown): v is number => isNum(v) && v >= 0 && v <= Date.now() + MAX_CLOCK_AHEAD_MS;
const CHANGE_TIME = 'a time no later than tomorrow';

/** A CSS hex colour: #rgb, #rrggbb or #rrggbbaa. Colours go into style attributes. */
const isColor = (v: unknown) => typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
/** An icon is an emoji or a letter or two; long enough for a family emoji sequence. */
const isIcon = (v: unknown) => typeof v === 'string' && v.length <= 32;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

function required(record: Record<string, unknown>, key: string, test: (v: unknown) => boolean, what: string): string | null {
  return test(record[key]) ? null : `${key} must be ${what}`;
}

function optional(record: Record<string, unknown>, key: string, test: (v: unknown) => boolean, what: string): string | null {
  const v = record[key];
  return v === undefined || v === null || test(v) ? null : `${key} must be ${what} when set`;
}

const isStringList = (max: number) => (v: unknown) => Array.isArray(v) && v.length <= max && v.every(isText);

function all(...results: (string | null)[]): string | null {
  return results.find((r) => r !== null) ?? null;
}

const checks: Record<Exclude<RecordKind, 'tombstones'>, Check> = {
  fasts: (r) =>
    all(
      required(r, 'uuid', isId, 'a non-empty string'),
      required(r, 'startTime', isNum, 'a number'),
      required(r, 'startDay', isNum, 'a number'),
      required(r, 'method', (v) => v === 'preset' || v === 'custom', "'preset' or 'custom'"),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'endTime', isNum, 'a number'),
      optional(r, 'presetId', isText, 'a string'),
      optional(r, 'presetLabel', isText, 'a string'),
      optional(r, 'targetHours', isNum, 'a number'),
      optional(r, 'moodRating', isNum, 'a number'),
      optional(r, 'energyRating', isNum, 'a number'),
      optional(r, 'hungerRating', isNum, 'a number'),
      optional(r, 'tags', isStringList(MAX_TAGS), 'a list of strings'),
      optional(r, 'note', isText, 'a string'),
    ),
  fieldDefinitions: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'name', isText, 'a string'),
      required(r, 'kind', (v) => v === 'number' || v === 'rating' || v === 'boolean', "'number', 'rating' or 'boolean'"),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'unit', isText, 'a string'),
      optional(r, 'ratingMin', isNum, 'a number'),
      optional(r, 'ratingMax', isNum, 'a number'),
      optional(r, 'aggregation', (v) => v === 'sum' || v === 'average' || v === 'last', "'sum', 'average' or 'last'"),
    ),
  trackableDefinitions: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'name', isText, 'a string'),
      required(r, 'icon', isIcon, 'an icon of up to 32 characters'),
      required(r, 'color', isColor, 'a hex colour like #a855f7'),
      required(r, 'fieldIds', isStringList(MAX_FIELD_IDS), 'a list of strings'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(
        r,
        'displayMode',
        (v) => typeof v === 'string' && ['occurrences', 'ages', 'event', 'measurement', 'daily', 'checkin'].includes(v),
        "'occurrences', 'ages', 'event', 'measurement', 'daily' or 'checkin'",
      ),
      optional(
        r,
        'goalType',
        (v) => typeof v === 'string' && ['dailyTotal', 'perDay', 'perWeek', 'everyDays', 'avoid'].includes(v),
        "'dailyTotal', 'perDay', 'perWeek', 'everyDays' or 'avoid'",
      ),
      optional(r, 'goalValue', (v) => isNum(v) && v > 0, 'a positive number'),
      optional(r, 'pinned', (v) => typeof v === 'boolean', 'a boolean'),
      optional(r, 'archived', (v) => typeof v === 'boolean', 'a boolean'),
      optional(r, 'sortOrder', isNum, 'a number'),
      optional(
        r,
        'scheduleDays',
        (v) => Array.isArray(v) && v.length <= 7 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        'a list of weekdays 0 to 6',
      ),
      optional(r, 'skipDays', (v) => Array.isArray(v) && v.length <= 2000 && v.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)), 'a list of YYYY-MM-DD dates'),
      optional(r, 'pausedUntil', isNum, 'a number'),
      optional(
        r,
        'dateKind',
        (v) => typeof v === 'string' && ['birthday', 'anniversary', 'holiday', 'countdown'].includes(v),
        "'birthday', 'anniversary', 'holiday' or 'countdown'",
      ),
      optional(r, 'dateLeadDays', (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 365, 'a whole number of days, 0 to 365'),
      optional(r, 'insightsHidden', (v) => typeof v === 'boolean', 'a boolean'),
      optional(
        r,
        'scheduleHistory',
        (v) =>
          Array.isArray(v) &&
          v.length <= 100 &&
          v.every(
            (h) =>
              isObject(h) &&
              isNum(h.until) &&
              (h.scheduleDays === undefined ||
                (Array.isArray(h.scheduleDays) && h.scheduleDays.length <= 7 && h.scheduleDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) &&
              Object.keys(h).every((k) => k === 'until' || k === 'scheduleDays'),
          ),
        'a list of { until, scheduleDays }',
      ),
    ),
  trackableEntries: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'trackableId', isId, 'a non-empty string'),
      required(r, 'timestamp', isNum, 'a number'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'note', isText, 'a string'),
      optional(r, 'tags', isStringList(MAX_TAGS), 'a list of strings'),
      optional(r, 'dateRepeat', isDateRepeat, 'a date repeat rule'),
      optional(r, 'details', isText, 'a string'),
      optional(
        r,
        'values',
        (v) =>
          isObject(v) &&
          Object.keys(v).length <= MAX_VALUES &&
          Object.entries(v).every(([k, x]) => k.length <= 200 && (isNum(x) || typeof x === 'boolean')),
        'an object of numbers or booleans',
      ),
    ),
  taskProjects: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'name', isText, 'a string'),
      required(r, 'color', isColor, 'a hex colour like #a855f7'),
      required(
        r,
        'sections',
        (v) =>
          Array.isArray(v) &&
          v.length <= MAX_SECTIONS &&
          v.every((s) => isObject(s) && isId(s.id) && isText(s.name) && Object.keys(s).every((k) => k === 'id' || k === 'name')) &&
          new Set(v.map((s) => (s as { id: string }).id)).size === v.length,
        'a list of { id, name } with different ids',
      ),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'icon', isIcon, 'an icon of up to 32 characters'),
      optional(r, 'notes', isText, 'a string'),
      optional(r, 'archived', (v) => typeof v === 'boolean', 'a boolean'),
      optional(r, 'sortOrder', isNum, 'a number'),
    ),
  tasks: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'name', isText, 'a string'),
      required(r, 'sortOrder', isNum, 'a number'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'projectId', isId, 'a non-empty string'),
      optional(r, 'sectionId', isId, 'a non-empty string'),
      optional(r, 'parentId', (v) => isId(v) && v !== r.id, "another task's id"),
      optional(r, 'notes', isText, 'a string'),
      optional(r, 'dueOn', isDay, 'a date like 2026-11-30'),
      optional(r, 'dueTime', isClock, "a time like '09:30'"),
      optional(r, 'repeat', isTaskRepeat, 'a task repeat rule'),
      optional(r, 'completedAt', isNum, 'a number'),
      r.dueTime != null && r.dueOn == null ? 'dueTime needs dueOn' : null,
      r.repeat != null && r.dueOn == null ? 'repeat needs dueOn' : null,
    ),
  taskCompletions: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'taskId', isId, 'a non-empty string'),
      required(r, 'completedAt', isNum, 'a number'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'dueOn', isDay, 'a date like 2026-11-30'),
      optional(r, 'nextDueOn', isDay, 'a date like 2026-11-30'),
      optional(r, 'subtaskIds', (v) => Array.isArray(v) && v.length <= MAX_SUBTASK_IDS && v.every(isId), 'a list of task ids'),
    ),
  settings: (r) =>
    all(
      required(r, 'id', (v) => v === 'app-settings', "'app-settings'"),
      required(r, 'updatedAt', isChangeTime, CHANGE_TIME),
      optional(r, 'defaultPresetId', isText, 'a string'),
      optional(r, 'notificationsEnabled', (v) => typeof v === 'boolean', 'a boolean'),
      optional(r, 'heightInches', isNum, 'a number'),
      optional(r, 'goalWeightLb', isNum, 'a number'),
      optional(r, 'weightFieldId', isId, 'a non-empty string'),
      optional(r, 'waistFieldId', isId, 'a non-empty string'),
      optional(r, 'neckFieldId', isId, 'a non-empty string'),
      optional(r, 'hipFieldId', isId, 'a non-empty string'),
      optional(r, 'bodyFatSex', (v) => v === 'male' || v === 'female', "'male' or 'female'"),
      optional(
        r,
        'customFastPresets',
        (v) =>
          Array.isArray(v) &&
          v.length <= 20 &&
          v.every((p) => isObject(p) && isId(p.id) && typeof p.label === 'string' && p.label.length <= 40 && isNum(p.targetHours) && p.targetHours > 0 && p.targetHours <= 240),
        'a list of { id, label, targetHours }',
      ),
      optional(r, 'fastScheduleTime', (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "a time like '20:00'"),
      optional(
        r,
        'fastWeekPlan',
        (v) =>
          Array.isArray(v) &&
          v.length === 7 &&
          v.every(
            (d) =>
              d === null ||
              (isObject(d) &&
                (d.presetId === undefined || (isId(d.presetId) && (d.presetId as string).length <= 64)) &&
                (d.time === undefined || (typeof d.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))) &&
                (d.rest === undefined || typeof d.rest === 'boolean')),
          ),
        'a list of 7 day plans',
      ),
      optional(
        r,
        'mutedInsights',
        (v) => Array.isArray(v) && v.length <= 500 && v.every((k) => typeof k === 'string' && /^[^|]{1,100}\|[^|]{1,100}\|[01]$/.test(k)),
        "a list of '<trackable>|<other>|<0 or 1>' keys",
      ),
    ),
};

const TOMBSTONE_TYPES = new Set(['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'taskProjects', 'tasks', 'taskCompletions']);

function checkTombstone(r: Record<string, unknown>): string | null {
  return all(
    required(r, 'recordType', (v) => typeof v === 'string' && TOMBSTONE_TYPES.has(v), 'a known record type'),
    required(r, 'uuid', isId, 'a non-empty string'),
    required(r, 'deletedAt', isChangeTime, CHANGE_TIME),
  );
}

/** Returns why `record` can't be stored, or null when it's fine. */
export function invalidReason(kind: RecordKind, record: unknown): string | null {
  if (!isObject(record)) return 'not an object';
  return kind === 'tombstones' ? checkTombstone(record) : checks[kind](record);
}

/** A best-effort key for reporting a rejected record back to the client. */
export function recordKey(record: unknown): string {
  if (!isObject(record)) return '';
  const key = record.uuid ?? record.id;
  return typeof key === 'string' ? key.slice(0, 200) : '';
}

/**
 * The fields each record type really has. An import keeps only these
 * (`pickKnown`), so a file can't bring a `deletedAt` that would delete a
 * record here without telling the server, or anything else that isn't data.
 * tests/dataFile.test.ts checks a full export keeps every field it has.
 */
export const KNOWN_KEYS: Record<Exclude<RecordKind, 'tombstones'>, readonly string[]> = {
  fasts: ['uuid', 'startTime', 'startDay', 'endTime', 'method', 'presetId', 'presetLabel', 'targetHours', 'moodRating', 'energyRating', 'hungerRating', 'tags', 'note', 'createdAt', 'updatedAt'],
  fieldDefinitions: ['id', 'name', 'kind', 'unit', 'ratingMin', 'ratingMax', 'aggregation', 'createdAt', 'updatedAt'],
  trackableDefinitions: [
    'id', 'name', 'icon', 'color', 'fieldIds', 'displayMode', 'goalType', 'goalValue', 'pinned', 'archived', 'sortOrder', 'scheduleDays', 'skipDays',
    'pausedUntil', 'dateKind', 'dateLeadDays', 'insightsHidden', 'scheduleHistory', 'createdAt', 'updatedAt',
  ],
  trackableEntries: ['id', 'trackableId', 'timestamp', 'note', 'tags', 'values', 'dateRepeat', 'details', 'createdAt', 'updatedAt'],
  taskProjects: ['id', 'name', 'color', 'icon', 'notes', 'sections', 'archived', 'sortOrder', 'createdAt', 'updatedAt'],
  tasks: ['id', 'name', 'projectId', 'sectionId', 'parentId', 'notes', 'dueOn', 'dueTime', 'repeat', 'completedAt', 'sortOrder', 'createdAt', 'updatedAt'],
  taskCompletions: ['id', 'taskId', 'completedAt', 'dueOn', 'nextDueOn', 'subtaskIds', 'createdAt', 'updatedAt'],
  settings: [
    'id', 'defaultPresetId', 'notificationsEnabled', 'heightInches', 'goalWeightLb', 'weightFieldId', 'waistFieldId', 'neckFieldId', 'hipFieldId',
    'bodyFatSex', 'fastScheduleTime', 'customFastPresets', 'fastWeekPlan', 'mutedInsights', 'updatedAt',
  ],
};

/** `record` with only the fields its type has (KNOWN_KEYS). */
export function pickKnown<T>(kind: Exclude<RecordKind, 'tombstones'>, record: T): T {
  const out: Record<string, unknown> = {};
  for (const k of KNOWN_KEYS[kind]) {
    const v = (record as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
