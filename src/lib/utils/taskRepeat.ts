// When a repeating task comes round again (ARCHITECTURE.md 3.61), and the
// rule in words. Works on calendar days ("YYYY-MM-DD") through UTC dates, so
// no time zone or DST change can move a date. Pure; tests/taskRepeat.test.ts.

import type { TaskRepeat } from '../db';

type Ymd = { y: number; m: number; d: number }; // m: 0 = January

const parse = (key: string): Ymd => {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d };
};
const fromUtc = (ms: number): string => {
  const t = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const utc = ({ y, m, d }: Ymd) => Date.UTC(y, m, d);
const DAY = 86_400_000;

export function addDaysKey(key: string, n: number): string {
  return fromUtc(utc(parse(key)) + n * DAY);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(key: string): number {
  return (new Date(utc(parse(key))).getUTCDay() + 6) % 7;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Day `day` (or -1: the last day) of the month `months` after `key`'s, clamped to that month's end. */
function onDayOfMonth(key: string, months: number, day: number): string {
  const { y, m } = parse(key);
  const target = new Date(Date.UTC(y, m + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = daysInMonth(ty, tm);
  return fromUtc(Date.UTC(ty, tm, day === -1 ? last : Math.min(day, last)));
}

/** The `nth` (1 to 5, or -1 for last) `weekday` of the month `months` after `key`'s; null when that month has no 5th. */
function nthWeekdayIn(key: string, months: number, nth: number, weekday: number): string | null {
  const { y, m } = parse(key);
  const first = new Date(Date.UTC(y, m + months, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth();
  const jsDay = (weekday + 1) % 7;
  if (nth === -1) {
    const last = daysInMonth(ty, tm);
    const lastDay = new Date(Date.UTC(ty, tm, last)).getUTCDay();
    return fromUtc(Date.UTC(ty, tm, last - ((lastDay - jsDay + 7) % 7)));
  }
  const day = 1 + ((jsDay - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  return day <= daysInMonth(ty, tm) ? fromUtc(Date.UTC(ty, tm, day)) : null;
}

/** Monday of `key`'s week. */
const mondayOf = (key: string) => addDaysKey(key, -weekdayOf(key));

/** Steps from `from` by `every` units, clamping a month or year step to the month's end (Jan 31 + 1 month = Feb 28). */
function step(from: string, every: number, unit: 'days' | 'weeks' | 'months' | 'years'): string {
  if (unit === 'days') return addDaysKey(from, every);
  if (unit === 'weeks') return addDaysKey(from, every * 7);
  return onDayOfMonth(from, unit === 'months' ? every : every * 12, parse(from).d);
}

/** Guards the search loops: a valid rule always finds a date well inside this many steps. */
const MAX_STEPS = 10_000;

/**
 * The next due date after completing (or skipping) a task due `dueOn` on day
 * `doneOn`.
 *
 * A fixed schedule (every N days, weeks, months or years) keeps its rhythm:
 * the next date is the first one on the schedule after both the due date and
 * the day it was done. So finishing early doesn't skip a turn, and finishing
 * late doesn't leave the task overdue for turns already missed. `afterDone`
 * counts from the day it was done instead.
 */
export function nextDue(repeat: TaskRepeat, dueOn: string, doneOn: string): string {
  const after = doneOn > dueOn ? doneOn : dueOn;
  switch (repeat.type) {
    case 'afterDone':
      return step(doneOn, repeat.every, repeat.unit);
    case 'days': {
      // Whole intervals past the due date, then one more if still not after `after`.
      const gap = Math.round((utc(parse(after)) - utc(parse(dueOn))) / DAY);
      const k = Math.floor(gap / repeat.every) + 1;
      return addDaysKey(dueOn, k * repeat.every);
    }
    case 'weeks': {
      const anchor = mondayOf(dueOn);
      const days = new Set(repeat.weekdays);
      let day = addDaysKey(after, 1);
      for (let i = 0; i < MAX_STEPS; i++, day = addDaysKey(day, 1)) {
        const weeks = Math.round((utc(parse(mondayOf(day))) - utc(parse(anchor))) / (7 * DAY));
        if (weeks % repeat.every === 0 && days.has(weekdayOf(day))) return day;
      }
      break;
    }
    case 'months':
      for (let k = 1; k < MAX_STEPS; k++) {
        const day = onDayOfMonth(dueOn, k * repeat.every, repeat.day);
        if (day > after) return day;
      }
      break;
    case 'monthsNth':
      for (let k = 1; k < MAX_STEPS; k++) {
        const day = nthWeekdayIn(dueOn, k * repeat.every, repeat.nth, repeat.weekday);
        if (day && day > after) return day;
      }
      break;
    case 'years':
      for (let k = 1; k < MAX_STEPS; k++) {
        const day = onDayOfMonth(dueOn, k * repeat.every * 12, parse(dueOn).d);
        if (day > after) return day;
      }
      break;
  }
  // Not reached for a valid rule (validate.ts); fall back to the next day.
  return addDaysKey(after, 1);
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NTH = new Map([
  [1, 'first'],
  [2, 'second'],
  [3, 'third'],
  [4, 'fourth'],
  [5, 'fifth'],
  [-1, 'last'],
]);

function ordinalDay(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

/** "Every week on Mon, Thu", "Every 3 months on the first Wednesday", "2 weeks after it's done". */
export function describeRepeat(repeat: TaskRepeat, dueOn?: string): string {
  switch (repeat.type) {
    case 'days':
      return every(repeat.every, 'day');
    case 'weeks': {
      const days = [...repeat.weekdays].sort((a, b) => a - b);
      const which = days.length === 7 ? 'every day' : days.length === 5 && days.every((d) => d < 5) ? 'weekdays' : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
      return `${every(repeat.every, 'week')} on ${which}`;
    }
    case 'months':
      return `${every(repeat.every, 'month')} on the ${repeat.day === -1 ? 'last day' : ordinalDay(repeat.day)}`;
    case 'monthsNth':
      return `${every(repeat.every, 'month')} on the ${NTH.get(repeat.nth)} ${WEEKDAY_LONG[repeat.weekday]}`;
    case 'years': {
      const on = dueOn ? ` on ${new Date(utc(parse(dueOn))).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : '';
      return `${every(repeat.every, 'year')}${on}`;
    }
    case 'afterDone':
      return `${repeat.every} ${repeat.every === 1 ? repeat.unit.slice(0, -1) : repeat.unit} after it's done`;
  }
}

export type RepeatKind = TaskRepeat['type'];

/** A rule of `type` that fits the due date: its weekday, its day of the month, its nth weekday. */
export function repeatFor(type: RepeatKind, dueOn: string, everyN = 1): TaskRepeat {
  const { d } = parse(dueOn);
  switch (type) {
    case 'days':
      return { type, every: everyN };
    case 'weeks':
      return { type, every: everyN, weekdays: [weekdayOf(dueOn)] };
    case 'months':
      return { type, every: everyN, day: d === daysInMonth(parse(dueOn).y, parse(dueOn).m) && d > 28 ? -1 : d };
    case 'monthsNth':
      return { type, every: everyN, nth: d > 28 ? -1 : Math.ceil(d / 7), weekday: weekdayOf(dueOn) };
    case 'years':
      return { type, every: everyN };
    case 'afterDone':
      return { type, every: everyN, unit: 'days' };
  }
}

/**
 * The rule after the due date moves from `oldDue` to `newDue`. A part of the
 * rule that came from the old date (its weekday, its day of the month, its
 * nth weekday) follows the new one, so moving a "weekly on Thursday" task to a
 * Wednesday makes it weekly on Wednesday. A part chosen apart from the date
 * (Mon and Thu, say) stays as it is.
 */
export function followDueDate(repeat: TaskRepeat, oldDue: string, newDue: string): TaskRepeat {
  if (oldDue === newDue) return repeat;
  const was = repeatFor(repeat.type, oldDue, repeat.every);
  const now = repeatFor(repeat.type, newDue, repeat.every);
  switch (repeat.type) {
    case 'weeks':
      return was.type === 'weeks' && now.type === 'weeks' && repeat.weekdays.length === 1 && repeat.weekdays[0] === was.weekdays[0]
        ? { ...repeat, weekdays: now.weekdays }
        : repeat;
    case 'months':
      return was.type === 'months' && now.type === 'months' && repeat.day === was.day ? { ...repeat, day: now.day } : repeat;
    case 'monthsNth':
      return was.type === 'monthsNth' && now.type === 'monthsNth' && repeat.nth === was.nth && repeat.weekday === was.weekday
        ? { ...repeat, nth: now.nth, weekday: now.weekday }
        : repeat;
    default:
      return repeat;
  }
}
