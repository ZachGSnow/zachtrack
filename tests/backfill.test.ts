import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import { backfillDays, backfillEntries, invalidCell, loggedByDay, type BackfillRow } from '../src/lib/utils/backfill';

const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
const field = (id: string, kind: FieldDefinition['kind'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ id, name: id, kind, createdAt: 0, updatedAt: 0, ...extra });

describe('back-fill grid', () => {
  it('lists the last days, today first, across a clock change', () => {
    const days = backfillDays(at(3, 9), 4);
    expect(days.map((d) => new Date(d).getDate())).toEqual([3, 2, 1, 31]);
    expect(days.every((d) => new Date(d).getHours() === 0)).toBe(true);
  });

  it('counts what each day already has', () => {
    const days = backfillDays(at(8), 3);
    const counts = loggedByDay([{ timestamp: at(8, 7) }, { timestamp: at(7, 23) }, { timestamp: at(7, 1) }, { timestamp: at(1) }], days);
    expect([...counts.values()]).toEqual([1, 2, 0]);
  });

  it('turns filled rows into noon entries and skips blank ones', () => {
    const fields = [field('w', 'number'), field('m', 'rating'), field('b', 'boolean')];
    const rows: BackfillRow[] = [
      { day: at(8, 0), values: { w: '181.4', m: '4', b: true } },
      { day: at(7, 0), values: { w: '', m: '', b: false } },
      { day: at(6, 0), values: { w: '182,0', m: '9' } },
    ];
    expect(backfillEntries('t1', rows, fields)).toEqual([
      { trackableId: 't1', timestamp: at(8), values: { w: 181.4, m: 4, b: true } },
      { trackableId: 't1', timestamp: at(6), values: { w: 182 } },
    ]);
    expect(invalidCell(fields[1], '9')).toBe(true);
    expect(invalidCell(fields[0], 'abc')).toBe(true);
    expect(invalidCell(fields[0], '')).toBe(false);
  });

  it('adds a plain entry for a ticked day when the trackable has no fields', () => {
    const rows: BackfillRow[] = [
      { day: at(8, 0), values: {}, done: true },
      { day: at(7, 0), values: {}, done: false },
    ];
    expect(backfillEntries('t2', rows, [])).toEqual([{ trackableId: 't2', timestamp: at(8) }]);
  });
});
