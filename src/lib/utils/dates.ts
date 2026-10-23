import type { DateKind, DateRepeat, TrackableDefinition, TrackableEntry } from '../db';
import { formatPreciseAge } from './age';
import { DAY_MS, startOfDay } from './time';

// Dates trackables (displayMode 'ages'): birthdays, anniversaries, holidays
// and countdowns or renewals. Each entry is a named date (entry.note is the
// name, entry.timestamp the date) that repeats by its DateRepeat (db.ts).
// Pure, so unit tested in tests/dates.test.ts.

export const DATE_KINDS: readonly DateKind[] = ['birthday', 'anniversary', 'holiday', 'countdown'];

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  birthday: 'Birthdays',
  anniversary: 'Anniversaries',
  holiday: 'Holidays',
  countdown: 'Countdowns and renewals',
};

/** What one entry of each kind is called, for buttons and the log sheet. */
export const DATE_KIND_ITEM: Record<DateKind, { add: string; name: string; namePlaceholder: string; date: string }> = {
  birthday: { add: 'Add person', name: 'Name', namePlaceholder: 'e.g. Mom', date: 'Birthdate' },
  anniversary: { add: 'Add anniversary', name: 'What', namePlaceholder: 'e.g. Wedding', date: 'Date it started' },
  holiday: { add: 'Add holiday', name: 'Holiday', namePlaceholder: 'e.g. Grandma\'s day', date: 'Date' },
  countdown: { add: 'Add date', name: 'What', namePlaceholder: 'e.g. Passport expires', date: 'Date' },
};

/** Days ahead a date shows in Needs attention, unless the trackable sets its own. */
export const DEFAULT_LEAD_DAYS: Record<DateKind, number> = { birthday: 7, anniversary: 7, holiday: 3, countdown: 30 };

/** Upcoming dates at most this far ahead are listed on the Dates page. */
export const UPCOMING_DAYS = 366;

type DatesTrackable = Pick<TrackableDefinition, 'id' | 'name' | 'icon' | 'color' | 'dateKind' | 'dateLeadDays'>;
type DateEntry = Pick<TrackableEntry, 'id' | 'timestamp' | 'note' | 'dateRepeat'>;

export function dateKindOf(t: Pick<TrackableDefinition, 'dateKind'>): DateKind {
  return t.dateKind ?? 'birthday';
}

export function leadDaysOf(t: Pick<TrackableDefinition, 'dateKind' | 'dateLeadDays'>): number {
  return t.dateLeadDays ?? DEFAULT_LEAD_DAYS[dateKindOf(t)];
}

export function defaultRepeat(kind: DateKind): DateRepeat {
  return kind === 'countdown' ? { type: 'once' } : { type: 'yearly' };
}

export function repeatOf(entry: Pick<TrackableEntry, 'dateRepeat'>, kind: DateKind): DateRepeat {
  return entry.dateRepeat ?? defaultRepeat(kind);
}

// ---------------------------------------------------------------------------
// When a date falls
// ---------------------------------------------------------------------------

/** Easter Sunday (Western), local midnight: the anonymous Gregorian algorithm. */
export function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day).getTime();
}

/** The `nth` (1 to 5, or -1 for the last) `weekday` (0 = Monday) of `month` in `year`; null when there's no 5th. */
export function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): number | null {
  const jsDay = (weekday + 1) % 7; // Date.getDay(): 0 = Sunday
  if (nth === -1) {
    const last = new Date(year, month + 1, 0);
    const back = (last.getDay() - jsDay + 7) % 7;
    return new Date(year, month, last.getDate() - back).getTime();
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((jsDay - first.getDay() + 7) % 7) + (nth - 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? d.getTime() : null;
}

/** The entry's month and day in `year`; Feb 29 falls on Feb 28 in other years. */
function onMonthDay(base: number, year: number, monthShift = 0): number {
  const b = new Date(base);
  const month = b.getMonth() + monthShift;
  const d = new Date(year, month, b.getDate());
  // Past the month's end (Feb 29, the 31st): the month's last day instead.
  if (d.getMonth() !== ((month % 12) + 12) % 12) return new Date(year, month + 1, 0).getTime();
  return d.getTime();
}

/** Where a yearly-type rule falls in `year`, or null. */
function inYear(entry: DateEntry, repeat: DateRepeat, year: number): number | null {
  switch (repeat.type) {
    case 'yearly':
      return onMonthDay(entry.timestamp, year);
    case 'nthWeekday':
      return nthWeekdayOf(year, repeat.month, repeat.weekday, repeat.nth);
    case 'easter':
      return easterSunday(year) + (repeat.offsetDays ?? 0) * DAY_MS;
    default:
      return null;
  }
}

/** Calendar days from `from`'s day to `at`'s day (negative when past), DST-safe. */
export function daysBetween(from: number, at: number): number {
  return Math.round((startOfDay(at) - startOfDay(from)) / DAY_MS);
}

/**
 * The next time this date falls on or after `now`'s day (local midnight). A
 * one-off date that has passed returns its own day, marked past.
 */
export function nextOccurrence(entry: DateEntry, kind: DateKind, now: number): { at: number; past: boolean } {
  const today = startOfDay(now);
  const repeat = repeatOf(entry, kind);
  if (repeat.type === 'once') {
    const at = startOfDay(entry.timestamp);
    return { at, past: at < today };
  }
  if (repeat.type === 'every') {
    const base = startOfDay(entry.timestamp);
    if (base >= today) return { at: base, past: false };
    const b = new Date(base);
    const t = new Date(today);
    const step = repeat.unit === 'years' ? repeat.count * 12 : repeat.count;
    const monthsApart = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
    for (let k = Math.max(1, Math.floor(monthsApart / step)); ; k++) {
      const at = onMonthDay(base, b.getFullYear(), k * step);
      if (at >= today) return { at, past: false };
    }
  }
  const year = new Date(today).getFullYear();
  for (const y of [year, year + 1, year + 2]) {
    const at = inYear(entry, repeat, y);
    if (at != null && at >= today) return { at, past: false };
  }
  return { at: today, past: false }; // not reached for valid rules
}

// ---------------------------------------------------------------------------
// In words
// ---------------------------------------------------------------------------

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** "Today", "Tomorrow", "in 12 days", "Yesterday", "12 days ago". */
export function formatDaysUntil(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Every year", "Once", "Every 10 years", "4th Thursday of November", "Easter Sunday". */
export function describeRepeat(repeat: DateRepeat): string {
  switch (repeat.type) {
    case 'yearly':
      return 'Every year';
    case 'once':
      return 'Once';
    case 'every':
      return repeat.count === 1 ? `Every ${repeat.unit === 'years' ? 'year' : 'month'}` : `Every ${repeat.count} ${repeat.unit}`;
    case 'nthWeekday':
      return `${repeat.nth === -1 ? 'Last' : ordinal(repeat.nth)} ${WEEKDAY_LONG[repeat.weekday]} of ${MONTHS[repeat.month]}`;
    case 'easter':
      return repeat.offsetDays ? `${Math.abs(repeat.offsetDays)} days ${repeat.offsetDays < 0 ? 'before' : 'after'} Easter` : 'Easter Sunday';
  }
}

export interface DateItem {
  trackableId: string;
  trackableName: string;
  icon: string;
  color: string;
  kind: DateKind;
  entryId: string;
  name: string;
  /** Local midnight of the next (or a past one-off's) day. */
  at: number;
  /** Days until it (0 = today); negative for a past one-off date. */
  daysUntil: number;
  /** "Today", "in 12 days", "3 days ago". */
  countdown: string;
  /** What this occurrence is: "Turns 61", "12th anniversary", "Every 10 years", or "". */
  detail: string;
  /** How long since the date began: "60 years 11 months" (birthdays and anniversaries). */
  since?: string;
  /** A round number of days (every 1,000), not the date itself. */
  milestone?: boolean;
}

/** One entry of a dates trackable, as the lists show it. */
export function describeDate(trackable: DatesTrackable, entry: DateEntry, now: number): DateItem {
  const kind = dateKindOf(trackable);
  const { at, past } = nextOccurrence(entry, kind, now);
  const daysUntil = daysBetween(now, at);
  const years = new Date(at).getFullYear() - new Date(entry.timestamp).getFullYear();
  const begun = startOfDay(entry.timestamp) <= startOfDay(now);
  let detail = '';
  let since: string | undefined;
  if (kind === 'birthday') {
    detail = years > 0 ? `Turns ${years}` : 'Born';
    if (begun) since = `${formatPreciseAge(entry.timestamp, now)} old`;
  } else if (kind === 'anniversary') {
    detail = years > 0 ? `${ordinal(years)} anniversary` : 'The day itself';
    if (begun) since = formatPreciseAge(entry.timestamp, now);
  } else {
    const repeat = repeatOf(entry, kind);
    detail = kind === 'holiday' || repeat.type === 'once' ? '' : describeRepeat(repeat);
  }
  return {
    trackableId: trackable.id,
    trackableName: trackable.name,
    icon: trackable.icon,
    color: trackable.color,
    kind,
    entryId: entry.id,
    name: entry.note?.trim() || 'Untitled',
    at,
    daysUntil,
    countdown: formatDaysUntil(daysUntil),
    detail: past ? '' : detail,
    ...(since ? { since } : {}),
  };
}

/** Every 1,000 days of a birthday or anniversary falling within `withinDays`: "10,000 days old". */
function milestones(trackable: DatesTrackable, entry: DateEntry, now: number, withinDays: number): DateItem[] {
  const kind = dateKindOf(trackable);
  if (kind !== 'birthday' && kind !== 'anniversary') return [];
  const start = startOfDay(entry.timestamp);
  const lived = daysBetween(start, now);
  if (lived < 0) return [];
  const out: DateItem[] = [];
  for (let n = Math.ceil(Math.max(lived, 1) / 1000) * 1000; daysBetween(now, start + n * DAY_MS) <= withinDays; n += 1000) {
    const at = startOfDay(new Date(start).setDate(new Date(start).getDate() + n));
    const daysUntil = daysBetween(now, at);
    if (daysUntil < 0) continue;
    const base = describeDate(trackable, entry, now);
    out.push({
      ...base,
      at,
      daysUntil,
      countdown: formatDaysUntil(daysUntil),
      detail: `${n.toLocaleString('en-US')} days ${kind === 'birthday' ? 'old' : 'since'}`,
      milestone: true,
    });
  }
  return out;
}

/** "Turns 61 in 3 days", "12th anniversary tomorrow", "Today": a date as a reminder line. */
export function dateReminderText(item: DateItem): string {
  const when = item.daysUntil <= 1 ? item.countdown.toLowerCase() : item.countdown;
  if (!item.detail) return item.countdown;
  return `${item.detail} ${when}`;
}

/**
 * The dates inside each trackable's lead time (Edit > Show in Needs attention
 * this many days ahead), soonest first: the in-app reminders for dates.
 */
export function datesDueSoon(
  trackables: readonly DatesTrackable[],
  entries: readonly (DateEntry & { trackableId: string })[],
  now: number,
): DateItem[] {
  return trackables
    .flatMap((t) => upcomingDates([t], entries, now, leadDaysOf(t)))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

/** A stable key for a listed date (an entry's date, or one of its milestones). */
export function dateItemKey(item: DateItem): string {
  return `${item.trackableId}:${item.entryId}${item.milestone ? `:${item.at}` : ''}`;
}

/**
 * Dates coming up across these trackables, soonest first: every entry whose
 * next occurrence is within `withinDays` (today included), plus 1,000-day
 * milestones. Past one-off dates are left out.
 */
export function upcomingDates(
  trackables: readonly DatesTrackable[],
  entries: readonly (DateEntry & { trackableId: string })[],
  now: number,
  withinDays: number,
): DateItem[] {
  const byId = new Map(trackables.map((t) => [t.id, t] as const));
  const items: DateItem[] = [];
  for (const e of entries) {
    const t = byId.get(e.trackableId);
    if (!t) continue;
    const item = describeDate(t, e, now);
    if (item.daysUntil >= 0 && item.daysUntil <= withinDays) items.push(item);
    items.push(...milestones(t, e, now, withinDays));
  }
  return items.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}
