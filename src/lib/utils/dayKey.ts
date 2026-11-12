// Calendar days as "YYYY-MM-DD", the way tasks store due dates. Day
// arithmetic goes through UTC dates, so no time zone or DST change can move a
// date. One copy of each helper (tasks, repeats, quick add and the database
// all use these). Pure; tests/dayKey.test.ts.

const DAY = 86_400_000;

/** Two digits: 7 is "07". */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The key for year `y`, month `m` (0 = January) and day `d`. */
export const ymdKey = (y: number, m: number, d: number): string => `${y}-${pad2(m + 1)}-${pad2(d)}`;

/** Year, month (0 = January) and day of a key. */
export function ymdOf(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m - 1, d];
}

const utcOf = (key: string): number => Date.UTC(...ymdOf(key));
const fromUtc = (ms: number): string => {
  const t = new Date(ms);
  return ymdKey(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};

/** The calendar day of `ms` in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return ymdKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight of a day. */
export function dayStart(key: string): number {
  const [y, m, d] = ymdOf(key);
  return new Date(y, m, d).getTime();
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysFrom(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY);
}

/** The day `n` days after `key` (before, when `n` is negative). */
export function addDaysKey(key: string, n: number): string {
  return fromUtc(utcOf(key) + n * DAY);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(key: string): number {
  return (new Date(utcOf(key)).getUTCDay() + 6) % 7;
}
