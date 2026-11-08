import { describe, expect, it } from 'vitest';
import { datesToIcs, escapeText, EASTER_YEARS } from '../src/lib/utils/ics';

// America/New_York (vitest config).
const NOW = new Date(2026, 10, 7, 12).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

const trackables = [
  { id: 'b', name: 'Birthdays', displayMode: 'ages' as const, dateKind: 'birthday' as const },
  { id: 'a', name: 'Anniversaries', displayMode: 'ages' as const, dateKind: 'anniversary' as const },
  { id: 'h', name: 'US holidays', displayMode: 'ages' as const, dateKind: 'holiday' as const },
  { id: 'c', name: 'Countdowns', displayMode: 'ages' as const, dateKind: 'countdown' as const },
  { id: 'x', name: 'Archived', displayMode: 'ages' as const, archived: true },
  { id: 'w', name: 'Weight' },
];
const entries = [
  { id: 'e1', trackableId: 'b', timestamp: day(1990, 11, 15), note: 'Alex' },
  { id: 'e2', trackableId: 'a', timestamp: day(2010, 3, 17), note: 'Us' },
  { id: 'e3', trackableId: 'h', timestamp: day(2000, 1, 1), note: 'Thanksgiving', dateRepeat: { type: 'nthWeekday' as const, month: 10, weekday: 3, nth: 4 } },
  { id: 'e4', trackableId: 'h', timestamp: day(2000, 1, 1), note: 'Good Friday', dateRepeat: { type: 'easter' as const, offsetDays: -2 } },
  { id: 'e5', trackableId: 'c', timestamp: day(2027, 3, 1), note: 'Passport, renew' },
  { id: 'e6', trackableId: 'c', timestamp: day(2026, 12, 1), note: 'Car tags', dateRepeat: { type: 'every' as const, count: 2, unit: 'years' as const } },
  { id: 'e7', trackableId: 'x', timestamp: day(2000, 5, 5), note: 'Hidden' },
  { id: 'e8', trackableId: 'w', timestamp: day(2026, 11, 1) },
];

describe('calendar export', () => {
  const ics = datesToIcs(trackables, entries, NOW);
  const events = ics.split('BEGIN:VEVENT').slice(1);
  const find = (uid: string) => events.find((e) => e.includes(`UID:${uid}@zachtrack`))!;

  it('wraps all-day events in a calendar with CRLF lines', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('\n') && !ics.replace(/\r\n/g, '').includes('\n')).toBe(true);
    // 5 entries plus 10 Easter years; the archived trackable and the non-dates one are left out.
    expect(events).toHaveLength(5 + EASTER_YEARS);
    expect(ics).not.toContain('Hidden');
  });

  it('repeats birthdays and anniversaries yearly from their first date', () => {
    const alex = find('e1');
    expect(alex).toContain('SUMMARY:Alex\'s birthday');
    expect(alex).toContain('DTSTART;VALUE=DATE:19901115');
    expect(alex).toContain('DTEND;VALUE=DATE:19901116');
    expect(alex).toContain('RRULE:FREQ=YEARLY');
    expect(find('e2')).toContain('SUMMARY:Us anniversary');
  });

  it('writes rule holidays as repeat rules and Easter ones year by year', () => {
    const thanks = find('e3');
    expect(thanks).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH');
    expect(thanks).toContain('DTSTART;VALUE=DATE:20261126');
    expect(find('e4-2027')).toContain('DTSTART;VALUE=DATE:20270326'); // Easter 2027 is Mar 28
    expect(find('e4-2027')).not.toContain('RRULE');
  });

  it('writes one-off and renewal countdowns, escaping text', () => {
    const passport = find('e5');
    expect(passport).toContain('SUMMARY:Passport\\, renew');
    expect(passport).not.toContain('RRULE');
    expect(find('e6')).toContain('RRULE:FREQ=YEARLY;INTERVAL=2');
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });
});
