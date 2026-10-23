// Shape checks for records arriving at /api/sync, also used to check an
// imported export file before anything is written (src/lib/dataFile.ts).
//
// D1 rejects a whole `db.batch()` when one statement fails (a NOT NULL
// column bound to undefined, say), so one malformed record from a client bug
// would make every later sync fail. Each record is checked here first;
// anything that doesn't match d1/schema.sql is left out of the batch and
// reported back in the response's `rejected` list, like a day conflict.
// Extra properties (e.g. Dexie's local `id` on fasts) are allowed and ignored.

export type RecordKind = 'fasts' | 'fieldDefinitions' | 'trackableDefinitions' | 'trackableEntries' | 'settings' | 'tombstones';

/** Longest string accepted in any text column (notes, names, tags). */
export const MAX_TEXT = 10_000;
const MAX_TAGS = 100;
const MAX_FIELD_IDS = 200;
const MAX_VALUES = 200;

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
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
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
      required(r, 'updatedAt', isNum, 'a number'),
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
      required(r, 'updatedAt', isNum, 'a number'),
      optional(r, 'unit', isText, 'a string'),
      optional(r, 'ratingMin', isNum, 'a number'),
      optional(r, 'ratingMax', isNum, 'a number'),
      optional(r, 'aggregation', (v) => v === 'sum' || v === 'average' || v === 'last', "'sum', 'average' or 'last'"),
    ),
  trackableDefinitions: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'name', isText, 'a string'),
      required(r, 'icon', isText, 'a string'),
      required(r, 'color', isText, 'a string'),
      required(r, 'fieldIds', isStringList(MAX_FIELD_IDS), 'a list of strings'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isNum, 'a number'),
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
    ),
  trackableEntries: (r) =>
    all(
      required(r, 'id', isId, 'a non-empty string'),
      required(r, 'trackableId', isId, 'a non-empty string'),
      required(r, 'timestamp', isNum, 'a number'),
      required(r, 'createdAt', isNum, 'a number'),
      required(r, 'updatedAt', isNum, 'a number'),
      optional(r, 'note', isText, 'a string'),
      optional(r, 'tags', isStringList(MAX_TAGS), 'a list of strings'),
      optional(r, 'dateRepeat', isDateRepeat, 'a date repeat rule'),
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
  settings: (r) =>
    all(
      required(r, 'id', (v) => v === 'app-settings', "'app-settings'"),
      required(r, 'updatedAt', isNum, 'a number'),
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
    ),
};

const TOMBSTONE_TYPES = new Set(['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries']);

function checkTombstone(r: Record<string, unknown>): string | null {
  return all(
    required(r, 'recordType', (v) => typeof v === 'string' && TOMBSTONE_TYPES.has(v), 'a known record type'),
    required(r, 'uuid', isId, 'a non-empty string'),
    required(r, 'deletedAt', isNum, 'a number'),
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
