import { describe, expect, it } from 'vitest';
import { holidayEntry, US_HOLIDAYS } from '../src/lib/data/holidays';
import { nextOccurrence } from '../src/lib/utils/dates';
import { invalidReason } from '../src/lib/validate';

// America/New_York (vitest config).
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe('US holiday pack', () => {
  it('lands every holiday on its known date, from the start of 2026', () => {
    const from = d(2026, 1, 1);
    const when = Object.fromEntries(US_HOLIDAYS.map((h) => [h.name, nextOccurrence({ ...holidayEntry(h), id: h.name }, 'holiday', from).at]));
    expect(when).toEqual({
      "New Year's Day": d(2026, 1, 1),
      'Martin Luther King Jr. Day': d(2026, 1, 19),
      "Valentine's Day": d(2026, 2, 14),
      "Presidents' Day": d(2026, 2, 16),
      "St. Patrick's Day": d(2026, 3, 17),
      Easter: d(2026, 4, 5),
      "Mother's Day": d(2026, 5, 10),
      'Memorial Day': d(2026, 5, 25),
      "Father's Day": d(2026, 6, 21),
      Juneteenth: d(2026, 6, 19),
      'Independence Day': d(2026, 7, 4),
      'Labor Day': d(2026, 9, 7),
      Halloween: d(2026, 10, 31),
      'Veterans Day': d(2026, 11, 11),
      Thanksgiving: d(2026, 11, 26),
      'Christmas Eve': d(2026, 12, 24),
      Christmas: d(2026, 12, 25),
      "New Year's Eve": d(2026, 12, 31),
    });
  });

  it('moves to next year once a holiday has passed', () => {
    const tg = US_HOLIDAYS.find((h) => h.name === 'Thanksgiving')!;
    expect(nextOccurrence({ ...holidayEntry(tg), id: 'tg' }, 'holiday', d(2026, 11, 27)).at).toBe(d(2027, 11, 25));
  });

  it('makes entries that pass validation', () => {
    for (const h of US_HOLIDAYS) {
      const e = { id: `e-${h.name}`, trackableId: 't', createdAt: 1, updatedAt: 1, ...holidayEntry(h) };
      expect(invalidReason('trackableEntries', e)).toBeNull();
    }
  });
});
