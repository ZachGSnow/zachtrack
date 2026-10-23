import type { DateRepeat } from '../db';

/**
 * The US holiday pack (New trackable > US holidays): federal holidays and
 * common observances. Fixed dates keep their month and day (the year is
 * unused); the rest follow a rule. Each becomes an ordinary entry, so any can
 * be edited or deleted.
 */
export interface HolidaySpec {
  name: string;
  /** Month (0 = January) and day of a fixed-date holiday. */
  fixed?: [month: number, day: number];
  rule?: DateRepeat;
}

export const US_HOLIDAYS: HolidaySpec[] = [
  { name: "New Year's Day", fixed: [0, 1] },
  { name: 'Martin Luther King Jr. Day', rule: { type: 'nthWeekday', month: 0, weekday: 0, nth: 3 } },
  { name: "Valentine's Day", fixed: [1, 14] },
  { name: "Presidents' Day", rule: { type: 'nthWeekday', month: 1, weekday: 0, nth: 3 } },
  { name: "St. Patrick's Day", fixed: [2, 17] },
  { name: 'Easter', rule: { type: 'easter' } },
  { name: "Mother's Day", rule: { type: 'nthWeekday', month: 4, weekday: 6, nth: 2 } },
  { name: 'Memorial Day', rule: { type: 'nthWeekday', month: 4, weekday: 0, nth: -1 } },
  { name: "Father's Day", rule: { type: 'nthWeekday', month: 5, weekday: 6, nth: 3 } },
  { name: 'Juneteenth', fixed: [5, 19] },
  { name: 'Independence Day', fixed: [6, 4] },
  { name: 'Labor Day', rule: { type: 'nthWeekday', month: 8, weekday: 0, nth: 1 } },
  { name: 'Halloween', fixed: [9, 31] },
  { name: 'Veterans Day', fixed: [10, 11] },
  { name: 'Thanksgiving', rule: { type: 'nthWeekday', month: 10, weekday: 3, nth: 4 } },
  { name: 'Christmas Eve', fixed: [11, 24] },
  { name: 'Christmas', fixed: [11, 25] },
  { name: "New Year's Eve", fixed: [11, 31] },
];

/** The entry fields for one holiday: its date (a leap year, so any day fits) and its rule. */
export function holidayEntry(spec: HolidaySpec): { timestamp: number; note: string; dateRepeat?: DateRepeat } {
  if (spec.fixed) return { timestamp: new Date(2000, spec.fixed[0], spec.fixed[1]).getTime(), note: spec.name };
  return { timestamp: new Date(2000, 0, 1).getTime(), note: spec.name, dateRepeat: spec.rule };
}
