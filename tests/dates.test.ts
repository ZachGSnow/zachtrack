import { describe, expect, it } from 'vitest';
import {
  describeDate,
  describeRepeat,
  easterSunday,
  formatDaysUntil,
  leadDaysOf,
  nextOccurrence,
  nthWeekdayOf,
  ordinal,
  upcomingDates,
} from '../src/lib/utils/dates';

// America/New_York (vitest config). Oct 23 2026 is a Friday.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();
const NOW = d(2026, 10, 23) + 15 * 3600_000;
const entry = (timestamp: number, note = 'X', dateRepeat?: Parameters<typeof nextOccurrence>[0]['dateRepeat']) => ({ id: note, timestamp, note, dateRepeat });
const trackable = (dateKind?: 'birthday' | 'anniversary' | 'holiday' | 'countdown', dateLeadDays?: number) => ({
  id: 't',
  name: 'Dates',
  icon: 'x',
  color: '#000000',
  dateKind,
  dateLeadDays,
});

describe('rules', () => {
  it('finds Easter for known years', () => {
    expect(easterSunday(2024)).toBe(d(2024, 3, 31));
    expect(easterSunday(2026)).toBe(d(2026, 4, 5));
    expect(easterSunday(2027)).toBe(d(2027, 3, 28));
  });

  it('finds the nth and last weekday of a month', () => {
    expect(nthWeekdayOf(2026, 10, 3, 4)).toBe(d(2026, 11, 26)); // Thanksgiving
    expect(nthWeekdayOf(2026, 4, 6, 2)).toBe(d(2026, 5, 10)); // Mother's Day
    expect(nthWeekdayOf(2026, 4, 0, -1)).toBe(d(2026, 5, 25)); // Memorial Day
    expect(nthWeekdayOf(2026, 1, 0, 5)).toBeNull(); // no 5th Monday in February 2026
  });

  it('describes rules in words', () => {
    expect(describeRepeat({ type: 'nthWeekday', month: 10, weekday: 3, nth: 4 })).toBe('4th Thursday of November');
    expect(describeRepeat({ type: 'nthWeekday', month: 4, weekday: 0, nth: -1 })).toBe('Last Monday of May');
    expect(describeRepeat({ type: 'every', count: 10, unit: 'years' })).toBe('Every 10 years');
    expect(describeRepeat({ type: 'easter', offsetDays: -2 })).toBe('2 days before Easter');
    expect(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(22) + ordinal(113)).toBe('1st2nd3rd11th22nd113th');
  });
});

describe('next occurrence', () => {
  it('a yearly date later this year, today, or next year', () => {
    expect(nextOccurrence(entry(d(1965, 11, 4)), 'birthday', NOW)).toEqual({ at: d(2026, 11, 4), past: false });
    expect(nextOccurrence(entry(d(1990, 10, 23)), 'birthday', NOW)).toEqual({ at: d(2026, 10, 23), past: false });
    expect(nextOccurrence(entry(d(1990, 3, 1)), 'birthday', NOW)).toEqual({ at: d(2027, 3, 1), past: false });
  });

  it('Feb 29 falls on Feb 28 outside leap years', () => {
    expect(nextOccurrence(entry(d(2000, 2, 29)), 'birthday', NOW).at).toBe(d(2027, 2, 28));
  });

  it('a one-off countdown, then past', () => {
    expect(nextOccurrence(entry(d(2026, 12, 15)), 'countdown', NOW)).toEqual({ at: d(2026, 12, 15), past: false });
    expect(nextOccurrence(entry(d(2026, 10, 10)), 'countdown', NOW)).toEqual({ at: d(2026, 10, 10), past: true });
  });

  it('every N months or years from the date', () => {
    expect(nextOccurrence(entry(d(2019, 6, 1), 'P', { type: 'every', count: 10, unit: 'years' }), 'countdown', NOW).at).toBe(d(2029, 6, 1));
    expect(nextOccurrence(entry(d(2026, 1, 31), 'R', { type: 'every', count: 1, unit: 'months' }), 'countdown', NOW).at).toBe(d(2026, 10, 31));
    expect(nextOccurrence(entry(d(2025, 8, 31), 'Q', { type: 'every', count: 3, unit: 'months' }), 'countdown', NOW).at).toBe(d(2026, 11, 30));
  });

  it('rule-based holidays this year or next', () => {
    expect(nextOccurrence(entry(0, 'Thanksgiving', { type: 'nthWeekday', month: 10, weekday: 3, nth: 4 }), 'holiday', NOW).at).toBe(d(2026, 11, 26));
    expect(nextOccurrence(entry(0, 'Easter', { type: 'easter' }), 'holiday', NOW).at).toBe(d(2027, 3, 28));
  });
});

describe('in words', () => {
  it('a birthday turns an age and says how old', () => {
    const item = describeDate(trackable('birthday'), entry(d(1965, 11, 4), 'Mom'), NOW);
    expect(item).toMatchObject({ name: 'Mom', daysUntil: 12, countdown: 'in 12 days', detail: 'Turns 61' });
    expect(item.since).toMatch(/^60 years 11 months \d+ days? old$/);
  });

  it('an anniversary says which one', () => {
    expect(describeDate(trackable('anniversary'), entry(d(2014, 10, 24), 'Wedding'), NOW)).toMatchObject({
      daysUntil: 1,
      countdown: 'Tomorrow',
      detail: '12th anniversary',
    });
  });

  it('a renewal says how often; a past one-off says how long ago', () => {
    expect(describeDate(trackable('countdown'), entry(d(2019, 6, 1), 'Passport', { type: 'every', count: 10, unit: 'years' }), NOW).detail).toBe('Every 10 years');
    expect(describeDate(trackable('countdown'), entry(d(2026, 10, 10), 'Trip'), NOW)).toMatchObject({ daysUntil: -13, countdown: '13 days ago' });
  });

  it('formats countdowns', () => {
    expect([0, 1, -1, 5, -5].map(formatDaysUntil)).toEqual(['Today', 'Tomorrow', 'Yesterday', 'in 5 days', '5 days ago']);
  });

  it('a birthday trackable without a kind set is birthdays, with its default lead time', () => {
    expect(describeDate(trackable(), entry(d(1990, 10, 23), 'Sam'), NOW).kind).toBe('birthday');
    expect(leadDaysOf(trackable())).toBe(7);
    expect(leadDaysOf(trackable('countdown', 60))).toBe(60);
  });
});

describe('upcoming', () => {
  it('lists dates within the window soonest first, leaves past one-offs out, and adds 1,000-day milestones', () => {
    const t = trackable('birthday');
    const entries = [
      { ...entry(d(1965, 11, 4), 'Mom'), trackableId: 't' },
      { ...entry(d(1990, 3, 1), 'Far'), trackableId: 't' },
      // 9,000 days old on Nov 1 2026.
      { ...entry(new Date(2026, 10, 1 - 9000).getTime(), 'Kid'), trackableId: 't' },
    ];
    const items = upcomingDates([t], entries, NOW, 14);
    expect(items.map((i) => [i.name, i.daysUntil, i.detail])).toEqual([
      ['Kid', 9, '9,000 days old'],
      ['Mom', 12, 'Turns 61'],
    ]);
  });
});
