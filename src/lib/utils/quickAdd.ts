// Due dates and repeat rules typed in plain words at the end of a task's name
// (ARCHITECTURE.md 3.64): "Pay bills fri", "Call the dentist tomorrow 9am",
// "Change oil every 6 months", "Take the bins out every week on sun". Only the
// end of the text is read, one phrase at a time, so a word like "sun" or "may"
// inside a name ("Buy sun screen") is left alone. Pure; tests/quickAdd.test.ts.

import type { TaskRepeat } from '../db';
import { addDaysKey, pad2 as pad, weekdayOf, ymdKey as key } from './dayKey';
import { describeRepeat, repeatFor } from './taskRepeat';

export interface QuickAdd {
  /** The task's name: the text without the phrases that were read. */
  name: string;
  dueOn?: string;
  dueTime?: string;
  repeat?: TaskRepeat;
  /** The phrases that were read, in the order they appear ("every week on sun"), for the preview. */
  read: string[];
}

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^mon(day)?$/, 0],
  [/^tue(s|sday)?$/, 1],
  [/^wed(nesday)?$/, 2],
  [/^thu(r|rs|rsday)?$/, 3],
  [/^fri(day)?$/, 4],
  [/^sat(urday)?$/, 5],
  [/^sun(day)?$/, 6],
];
const WEEKDAY = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NTH: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: -1 };
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, other: 2 };
const UNIT = '(day|week|month|year)s?';

const weekdayIndex = (w: string) => WEEKDAYS.find(([re]) => re.test(w))?.[1] ?? -1;
const count = (s: string | undefined) => (s == null ? 1 : (NUM_WORDS[s] ?? Number(s)));
const parts = (k: string) => k.split('-').map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The first `weekday` on or after `from`. */
function onOrAfter(from: string, weekday: number): string {
  return addDaysKey(from, (weekday - weekdayOf(from) + 7) % 7);
}

/** `from` plus `n` months, clamped to the month's end. */
function addMonths(from: string, n: number, day?: number): string {
  const [y, m, d] = parts(from);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth();
  return key(ty, tm, Math.min(day ?? d, daysIn(ty, tm)));
}

type Found = { kind: 'date'; dueOn: string } | { kind: 'time'; dueTime: string } | { kind: 'repeat'; repeat: Partial<TaskRepeat> & { type: TaskRepeat['type'] } };

interface Rule {
  re: RegExp;
  make: (m: RegExpMatchArray, today: string) => Found | null;
}

const end = (body: string) => new RegExp(`(?:^|\\s+)(?:(?:on|due|by|at)\\s+)?(${body})[.,!]?$`, 'i');

const TIME_RULES: Rule[] = [
  {
    re: end('(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)'),
    make: (m) => {
      const h = Number(m[2]);
      const min = Number(m[3] ?? 0);
      if (h < 1 || h > 12 || min > 59) return null;
      return { kind: 'time', dueTime: `${pad((h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0))}:${pad(min)}` };
    },
  },
  {
    re: end('([01]?\\d|2[0-3]):([0-5]\\d)'),
    make: (m) => ({ kind: 'time', dueTime: `${pad(Number(m[2]))}:${m[3]}` }),
  },
  { re: end('noon'), make: () => ({ kind: 'time', dueTime: '12:00' }) },
];

const DATE_RULES: Rule[] = [
  { re: end('today|tonight'), make: (_m, today) => ({ kind: 'date', dueOn: today }) },
  { re: end('tomorrow|tmrw|tmr'), make: (_m, today) => ({ kind: 'date', dueOn: addDaysKey(today, 1) }) },
  { re: end('yesterday'), make: (_m, today) => ({ kind: 'date', dueOn: addDaysKey(today, -1) }) },
  {
    re: end('(?:this\\s+)?weekend'),
    make: (_m, today) => ({ kind: 'date', dueOn: weekdayOf(today) === 6 ? today : onOrAfter(today, 5) }),
  },
  { re: end('next\\s+week'), make: (_m, today) => ({ kind: 'date', dueOn: addDaysKey(today, 7 - weekdayOf(today)) }) },
  { re: end('next\\s+month'), make: (_m, today) => ({ kind: 'date', dueOn: addMonths(today, 1, 1) }) },
  {
    re: end(`next\\s+(${WEEKDAY})`),
    // The weekday in next week (weeks start on Monday).
    make: (m, today) => ({ kind: 'date', dueOn: addDaysKey(addDaysKey(today, 7 - weekdayOf(today)), weekdayIndex(m[2].toLowerCase())) }),
  },
  { re: end(`(?:this\\s+)?(${WEEKDAY})`), make: (m, today) => ({ kind: 'date', dueOn: onOrAfter(today, weekdayIndex(m[2].toLowerCase())) }) },
  {
    re: end(`in\\s+(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\\s+${UNIT}`),
    make: (m, today) => {
      const n = count(m[2].toLowerCase());
      const unit = m[3].toLowerCase();
      if (unit === 'day') return { kind: 'date', dueOn: addDaysKey(today, n) };
      if (unit === 'week') return { kind: 'date', dueOn: addDaysKey(today, 7 * n) };
      return { kind: 'date', dueOn: addMonths(today, unit === 'month' ? n : 12 * n) };
    },
  },
  {
    re: end(`(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`),
    make: (m, today) => monthDay(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), Number(m[3]), m[4], today),
  },
  {
    re: end(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})(?:,?\\s+(\\d{4}))?`),
    make: (m, today) => monthDay(MONTHS.indexOf(m[3].slice(0, 3).toLowerCase()), Number(m[2]), m[4], today),
  },
  {
    re: end('(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?'),
    make: (m, today) => monthDay(Number(m[2]) - 1, Number(m[3]), m[4] && m[4].length === 2 ? `20${m[4]}` : m[4], today),
  },
  {
    re: end('(\\d{4})-(\\d{2})-(\\d{2})'),
    make: (m, today) => monthDay(Number(m[3]) - 1, Number(m[4]), m[2], today),
  },
];

/** A month and day, this year if it hasn't passed, else next; or in the year given. Null if the day doesn't exist. */
function monthDay(month: number, day: number, year: string | undefined, today: string): Found | null {
  if (month < 0 || month > 11) return null;
  const [ty] = parts(today);
  const y = year ? Number(year) : ty;
  if (day < 1 || day > daysIn(y, month)) {
    // Feb 29 without a year: the next leap year.
    if (!year && month === 1 && day === 29) {
      let ly = ty;
      while (daysIn(ly, 1) < 29 || key(ly, 1, 29) < today) ly++;
      return { kind: 'date', dueOn: key(ly, 1, 29) };
    }
    return null;
  }
  let k = key(y, month, day);
  if (!year && k < today) k = key(y + 1, month, Math.min(day, daysIn(y + 1, month)));
  return { kind: 'date', dueOn: k };
}

const EVERY_N = '(?:(\\d+|two|three|four|five|six|seven|eight|nine|ten|twelve|other)\\s+)?';

const REPEAT_RULES: Rule[] = [
  {
    re: end(`(?:every\\s+${EVERY_N}${UNIT}|(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\\s+${UNIT})\\s+after\\s+(?:it'?s\\s+|it\\s+is\\s+)?(?:done|completion|completed|finished)`),
    make: (m) => {
      const n = m[2] != null || m[3] != null ? count((m[2] ?? '').toLowerCase() || undefined) : count(m[4].toLowerCase());
      const unit = (m[3] ?? m[5]).toLowerCase();
      return { kind: 'repeat', repeat: { type: 'afterDone', every: n, unit: `${unit}s` as 'days' } };
    },
  },
  { re: end('daily|every\\s+day'), make: () => ({ kind: 'repeat', repeat: { type: 'days', every: 1 } }) },
  { re: end('every\\s+weekday'), make: () => ({ kind: 'repeat', repeat: { type: 'weeks', every: 1, weekdays: [0, 1, 2, 3, 4] } }) },
  { re: end('every\\s+weekend'), make: () => ({ kind: 'repeat', repeat: { type: 'weeks', every: 1, weekdays: [5, 6] } }) },
  { re: end('weekly'), make: () => ({ kind: 'repeat', repeat: { type: 'weeks', every: 1 } }) },
  { re: end('monthly'), make: () => ({ kind: 'repeat', repeat: { type: 'months', every: 1 } }) },
  { re: end('yearly|annually'), make: () => ({ kind: 'repeat', repeat: { type: 'years', every: 1 } }) },
  {
    // every 2 weeks on mon and thu / every week on fri / every mon, thu / every other fri
    re: end(`every\\s+(?:${EVERY_N}weeks?\\s+on\\s+|(other)\\s+)?(${WEEKDAY}(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*&\\s*)${WEEKDAY})*)`),
    make: (m) => {
      const n = m[3] ? 2 : count(m[2]?.toLowerCase());
      const days = m[4]
        .toLowerCase()
        .split(/\s*,\s*|\s+and\s+|\s*&\s*/)
        .map(weekdayIndex);
      if (days.some((d) => d < 0)) return null;
      return { kind: 'repeat', repeat: { type: 'weeks', every: n, weekdays: [...new Set(days)].sort((a, b) => a - b) } };
    },
  },
  {
    // every first wed / every 3 months on the last fri / every last friday of the month
    re: end(`every\\s+(?:${EVERY_N}months?\\s+on\\s+)?(?:the\\s+)?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\\s+(${WEEKDAY})(?:\\s+of\\s+(?:the|each|every)\\s+month)?`),
    make: (m) => ({
      kind: 'repeat',
      repeat: { type: 'monthsNth', every: count(m[2]?.toLowerCase()), nth: NTH[m[3].toLowerCase()], weekday: weekdayIndex(m[4].toLowerCase()) },
    }),
  },
  {
    // every month on the 15th / every 3 months on the last day / every 15th
    re: end(`every\\s+(?:${EVERY_N}months?\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+(?:the|each|every)\\s+month)?|every\\s+${EVERY_N}months?\\s+on\\s+the\\s+last\\s+day`),
    make: (m) => {
      if (m[3] != null) {
        const day = Number(m[3]);
        return day >= 1 && day <= 31 ? { kind: 'repeat', repeat: { type: 'months', every: count(m[2]?.toLowerCase()), day } } : null;
      }
      return { kind: 'repeat', repeat: { type: 'months', every: count(m[4]?.toLowerCase()), day: -1 } };
    },
  },
  {
    re: end(`every\\s+${EVERY_N}${UNIT}`),
    make: (m) => {
      const n = count(m[2]?.toLowerCase());
      const unit = m[3].toLowerCase();
      const type = unit === 'day' ? 'days' : unit === 'week' ? 'weeks' : unit === 'month' ? 'months' : 'years';
      return { kind: 'repeat', repeat: { type, every: n } };
    },
  },
];

/** The first date on or after `today` that the rule lands on, for a repeat typed without a date. */
function firstDate(repeat: TaskRepeat, today: string): string {
  switch (repeat.type) {
    case 'weeks': {
      const day = [...repeat.weekdays].sort((a, b) => ((a - weekdayOf(today) + 7) % 7) - ((b - weekdayOf(today) + 7) % 7))[0];
      return onOrAfter(today, day);
    }
    case 'months': {
      const [y, m, d] = parts(today);
      const last = daysIn(y, m - 1);
      const day = repeat.day === -1 ? last : Math.min(repeat.day, last);
      return day >= d ? key(y, m - 1, day) : addMonths(today, 1, repeat.day === -1 ? 31 : repeat.day);
    }
    case 'monthsNth': {
      for (let k = 0; k < 14; k++) {
        const first = addMonths(today, k, 1);
        const [y, m] = parts(first);
        const lastDay = key(y, m - 1, daysIn(y, m - 1));
        const at = repeat.nth === -1 ? addDaysKey(lastDay, -((weekdayOf(lastDay) - repeat.weekday + 7) % 7)) : addDaysKey(onOrAfter(first, repeat.weekday), 7 * (repeat.nth - 1));
        if (at.slice(0, 7) === first.slice(0, 7) && at >= today) return at;
      }
      return today;
    }
    default:
      return today;
  }
}

/** Reads a due date, a time and a repeat rule from the end of `text`. */
export function parseQuickAdd(text: string, today: string): QuickAdd {
  let rest = text.trim();
  const found: { date?: string; time?: string; repeat?: Partial<TaskRepeat> & { type: TaskRepeat['type'] } } = {};
  const read: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let matched = false;
    for (const [kind, rules] of [
      ['repeat', REPEAT_RULES],
      ['date', DATE_RULES],
      ['time', TIME_RULES],
    ] as const) {
      if ((kind === 'repeat' && found.repeat) || (kind === 'date' && found.date) || (kind === 'time' && found.time)) continue;
      for (const rule of rules) {
        const m = rest.match(rule.re);
        if (!m || m.index == null) continue;
        const f = rule.make(m, today);
        if (!f) continue;
        if (f.kind === 'date') found.date = f.dueOn;
        else if (f.kind === 'time') found.time = f.dueTime;
        else found.repeat = f.repeat;
        read.unshift(m[0].trim().replace(/[.,!]$/, ''));
        rest = rest.slice(0, m.index).replace(/[\s,;:-]+$/, '');
        matched = true;
        break;
      }
      if (matched) break;
    }
    if (!matched) break;
  }
  // Nothing left for a name: it was all date words ("tomorrow"), so it's the name.
  if (!rest || read.length === 0) return { name: text.trim(), read: [] };

  let dueOn = found.date;
  let repeat: TaskRepeat | undefined;
  if (found.repeat) {
    const base = dueOn ?? today;
    const filled = { ...repeatFor(found.repeat.type, base, found.repeat.every ?? 1), ...found.repeat } as TaskRepeat;
    repeat = filled;
    dueOn ??= firstDate(filled, today);
  }
  if (found.time && !dueOn) dueOn = today;
  return { name: rest, ...(dueOn ? { dueOn } : {}), ...(found.time ? { dueTime: found.time } : {}), ...(repeat ? { repeat } : {}), read };
}

/** "Due Fri, Nov 14, 9:00 AM, every week on Fri": what a parsed phrase sets, for the preview under the box. */
export function describeQuickAdd(q: QuickAdd, describeDueText: (dueOn: string, dueTime?: string) => string): string {
  if (!q.dueOn) return '';
  return `Due ${describeDueText(q.dueOn, q.dueTime)}${q.repeat ? `, ${describeRepeat(q.repeat, q.dueOn).replace(/^E/, 'e')}` : ''}`;
}
