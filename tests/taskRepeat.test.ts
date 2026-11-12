import { describe, expect, it } from 'vitest';
import type { TaskRepeat } from '../src/lib/db';
import { addDaysKey, describeRepeat, followDueDate, nextDue, repeatFor, weekdayOf } from '../src/lib/utils/taskRepeat';

// The repeat engine (ARCHITECTURE.md 3.61). 2026-11-11 is a Wednesday.

describe('days', () => {
  it('steps calendar days across month, year and DST boundaries', () => {
    expect(addDaysKey('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysKey('2028-03-01', -1)).toBe('2028-02-29');
    expect(weekdayOf('2026-11-11')).toBe(2);
    expect(weekdayOf('2026-11-16')).toBe(0);
  });
});

describe('nextDue on a fixed schedule', () => {
  it('every N days keeps its rhythm, done on time, early or late', () => {
    const r = { type: 'days', every: 3 } as const;
    expect(nextDue(r, '2026-11-11', '2026-11-11')).toBe('2026-11-14');
    expect(nextDue(r, '2026-11-11', '2026-11-09')).toBe('2026-11-14'); // early: no turn skipped
    expect(nextDue(r, '2026-11-11', '2026-11-15')).toBe('2026-11-17'); // late: the next turn after today
    expect(nextDue(r, '2026-11-11', '2026-11-14')).toBe('2026-11-17');
  });

  it('every N weeks on chosen weekdays', () => {
    const monThu: TaskRepeat = { type: 'weeks', every: 1, weekdays: [0, 3] };
    expect(nextDue(monThu, '2026-11-16', '2026-11-16')).toBe('2026-11-19');
    expect(nextDue(monThu, '2026-11-19', '2026-11-19')).toBe('2026-11-23');
    const fortnightlyFri: TaskRepeat = { type: 'weeks', every: 2, weekdays: [4] };
    expect(nextDue(fortnightlyFri, '2026-11-13', '2026-11-13')).toBe('2026-11-27');
    // Done late, in an off week: the next Friday on the schedule, not the next Friday.
    expect(nextDue(fortnightlyFri, '2026-11-13', '2026-11-18')).toBe('2026-11-27');
    expect(nextDue(fortnightlyFri, '2026-11-13', '2026-11-28')).toBe('2026-12-11');
  });

  it('every N months on a day, clamped to short months, or on the last day', () => {
    expect(nextDue({ type: 'months', every: 1, day: 31 }, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
    expect(nextDue({ type: 'months', every: 1, day: 31 }, '2027-02-28', '2027-02-28')).toBe('2027-03-31');
    expect(nextDue({ type: 'months', every: 1, day: -1 }, '2028-01-31', '2028-01-31')).toBe('2028-02-29');
    expect(nextDue({ type: 'months', every: 6, day: 1 }, '2026-11-01', '2026-11-01')).toBe('2027-05-01');
    expect(nextDue({ type: 'months', every: 1, day: 15 }, '2026-11-15', '2026-12-20')).toBe('2027-01-15');
  });

  it('every N months on the nth or last weekday, skipping months without a 5th', () => {
    // First Wednesday every 3 months: Dec 2 2026, then Mar 3 2027.
    expect(nextDue({ type: 'monthsNth', every: 3, nth: 1, weekday: 2 }, '2026-12-02', '2026-12-02')).toBe('2027-03-03');
    // Last Friday of the month.
    expect(nextDue({ type: 'monthsNth', every: 1, nth: -1, weekday: 4 }, '2026-11-27', '2026-11-27')).toBe('2026-12-25');
    // Fifth Thursday: Oct 29 2026, then the next month with five Thursdays (Dec 31 2026).
    expect(nextDue({ type: 'monthsNth', every: 1, nth: 5, weekday: 3 }, '2026-10-29', '2026-10-29')).toBe('2026-12-31');
  });

  it('every N years, with February 29 on February 28 in other years', () => {
    expect(nextDue({ type: 'years', every: 1 }, '2026-11-11', '2026-11-11')).toBe('2027-11-11');
    expect(nextDue({ type: 'years', every: 1 }, '2028-02-29', '2028-02-29')).toBe('2029-02-28');
    expect(nextDue({ type: 'years', every: 2 }, '2026-04-30', '2029-01-01')).toBe('2030-04-30');
  });
});

describe('nextDue after completion', () => {
  it('counts from the day it was done, with no cap on the interval', () => {
    expect(nextDue({ type: 'afterDone', every: 10, unit: 'days' }, '2026-11-01', '2026-11-11')).toBe('2026-11-21');
    expect(nextDue({ type: 'afterDone', every: 180, unit: 'days' }, '2026-11-01', '2026-11-11')).toBe('2027-05-10');
    expect(nextDue({ type: 'afterDone', every: 6, unit: 'months' }, '2026-11-01', '2026-08-31')).toBe('2027-02-28');
    expect(nextDue({ type: 'afterDone', every: 2, unit: 'weeks' }, '2026-11-20', '2026-11-11')).toBe('2026-11-25');
  });
});

describe('in words', () => {
  it('describes each kind of rule', () => {
    expect(describeRepeat({ type: 'days', every: 1 })).toBe('Every day');
    expect(describeRepeat({ type: 'days', every: 3 })).toBe('Every 3 days');
    expect(describeRepeat({ type: 'weeks', every: 1, weekdays: [3, 0] })).toBe('Every week on Mon, Thu');
    expect(describeRepeat({ type: 'weeks', every: 1, weekdays: [0, 1, 2, 3, 4] })).toBe('Every week on weekdays');
    expect(describeRepeat({ type: 'weeks', every: 2, weekdays: [4] })).toBe('Every 2 weeks on Fri');
    expect(describeRepeat({ type: 'months', every: 1, day: 22 })).toBe('Every month on the 22nd');
    expect(describeRepeat({ type: 'months', every: 1, day: -1 })).toBe('Every month on the last day');
    expect(describeRepeat({ type: 'monthsNth', every: 3, nth: 1, weekday: 2 })).toBe('Every 3 months on the first Wednesday');
    expect(describeRepeat({ type: 'years', every: 1 }, '2026-11-11')).toMatch(/^Every year on Nov 11/);
    expect(describeRepeat({ type: 'afterDone', every: 1, unit: 'weeks' })).toBe("1 week after it's done");
    expect(describeRepeat({ type: 'afterDone', every: 180, unit: 'days' })).toBe("180 days after it's done");
  });

  it('makes a rule that fits the due date', () => {
    expect(repeatFor('weeks', '2026-11-11')).toEqual({ type: 'weeks', every: 1, weekdays: [2] });
    expect(repeatFor('months', '2026-11-11')).toEqual({ type: 'months', every: 1, day: 11 });
    expect(repeatFor('months', '2026-11-30')).toEqual({ type: 'months', every: 1, day: -1 });
    expect(repeatFor('monthsNth', '2026-11-11', 3)).toEqual({ type: 'monthsNth', every: 3, nth: 2, weekday: 2 });
    expect(repeatFor('monthsNth', '2026-11-30')).toMatchObject({ nth: -1, weekday: 0 });
  });
});

describe('moving the due date', () => {
  it('carries the parts of the rule that came from the old date, and keeps the ones chosen apart from it', () => {
    // Thu Nov 12 -> Wed Nov 11
    expect(followDueDate({ type: 'weeks', every: 1, weekdays: [3] }, '2026-11-12', '2026-11-11')).toEqual({ type: 'weeks', every: 1, weekdays: [2] });
    expect(followDueDate({ type: 'weeks', every: 1, weekdays: [0, 3] }, '2026-11-12', '2026-11-11')).toEqual({ type: 'weeks', every: 1, weekdays: [0, 3] });
    expect(followDueDate({ type: 'months', every: 1, day: 12 }, '2026-11-12', '2026-11-20')).toEqual({ type: 'months', every: 1, day: 20 });
    expect(followDueDate({ type: 'months', every: 1, day: 1 }, '2026-11-12', '2026-11-20')).toEqual({ type: 'months', every: 1, day: 1 });
    expect(followDueDate({ type: 'monthsNth', every: 3, nth: 2, weekday: 3 }, '2026-11-12', '2026-11-04')).toEqual({ type: 'monthsNth', every: 3, nth: 1, weekday: 2 });
    expect(followDueDate({ type: 'days', every: 3 }, '2026-11-12', '2026-11-04')).toEqual({ type: 'days', every: 3 });
  });
});
