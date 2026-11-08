import type { FieldDefinition, TrackableEntry } from '../db';
import { addDays, startOfDay } from './time';

// The back-fill grid on a trackable's page (ARCHITECTURE.md 3.58): the last
// week or two as rows, one cell per field, so days missed on a trip go in
// from a laptop in one pass instead of an entry sheet per day. Pure;
// tests/backfill.test.ts.

export interface BackfillRow {
  /** Start of the day. */
  day: number;
  /** fieldId -> what was typed or picked; '' when left blank. */
  values: Record<string, string | boolean>;
  /** For a trackable without fields: the day happened. */
  done?: boolean;
}

/** The last `count` days, today first. */
export function backfillDays(now: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => addDays(startOfDay(now), -i));
}

/** How many entries each of those days already has. */
export function loggedByDay(entries: readonly Pick<TrackableEntry, 'timestamp'>[], days: readonly number[]): Map<number, number> {
  const counts = new Map(days.map((d) => [d, 0]));
  for (const e of entries) {
    const d = startOfDay(e.timestamp);
    if (counts.has(d)) counts.set(d, counts.get(d)! + 1);
  }
  return counts;
}

function valueOf(field: FieldDefinition, raw: string | boolean | undefined): number | boolean | undefined {
  if (field.kind === 'boolean') return raw === true ? true : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  if (field.kind === 'rating') {
    const [min, max] = [field.ratingMin ?? 1, field.ratingMax ?? 5];
    return n >= min && n <= max ? Math.round(n) : undefined;
  }
  return n;
}

/** The entries to add: one at noon for each row with a value (or ticked, without fields). Rows left blank add nothing. */
export function backfillEntries(trackableId: string, rows: readonly BackfillRow[], fields: readonly FieldDefinition[]): Omit<TrackableEntry, 'id' | 'createdAt' | 'updatedAt'>[] {
  const out: Omit<TrackableEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (const r of rows) {
    const timestamp = r.day + 12 * 3600_000;
    if (fields.length === 0) {
      if (r.done) out.push({ trackableId, timestamp });
      continue;
    }
    const values: Record<string, number | boolean> = {};
    for (const f of fields) {
      const v = valueOf(f, r.values[f.id]);
      if (v !== undefined) values[f.id] = v;
    }
    if (Object.keys(values).length > 0) out.push({ trackableId, timestamp, values });
  }
  return out;
}

/** A typed cell that won't be saved: not a number, or a rating out of range. */
export function invalidCell(field: FieldDefinition, raw: string | boolean | undefined): boolean {
  return field.kind !== 'boolean' && typeof raw === 'string' && raw.trim() !== '' && valueOf(field, raw) === undefined;
}
