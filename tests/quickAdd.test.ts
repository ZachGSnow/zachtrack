import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/utils/quickAdd';

// Plain-words dates at the end of a task (ARCHITECTURE.md 3.64).
// 2026-11-11 is a Wednesday.
const today = '2026-11-11';
const p = (text: string) => parseQuickAdd(text, today);

describe('dates', () => {
  it('reads relative days and weekdays', () => {
    expect(p('Call the dentist today')).toMatchObject({ name: 'Call the dentist', dueOn: '2026-11-11' });
    expect(p('Call the dentist tomorrow')).toMatchObject({ name: 'Call the dentist', dueOn: '2026-11-12' });
    expect(p('Return the library book yesterday')).toMatchObject({ name: 'Return the library book', dueOn: '2026-11-10' });
    expect(p('Pay bills fri')).toMatchObject({ name: 'Pay bills', dueOn: '2026-11-13' });
    expect(p('Pay bills on Friday')).toMatchObject({ name: 'Pay bills', dueOn: '2026-11-13' });
    expect(p('Pay bills wed')).toMatchObject({ dueOn: '2026-11-11' }); // today counts
    expect(p('Pay bills next fri')).toMatchObject({ dueOn: '2026-11-20' });
    expect(p('Mow this weekend')).toMatchObject({ name: 'Mow', dueOn: '2026-11-14' });
    expect(p('Plan trip next week')).toMatchObject({ name: 'Plan trip', dueOn: '2026-11-16' });
    expect(p('Renew passport next month')).toMatchObject({ dueOn: '2026-12-01' });
    expect(p('Check tires in 3 weeks')).toMatchObject({ name: 'Check tires', dueOn: '2026-12-02' });
    expect(p('Check tires in two months')).toMatchObject({ dueOn: '2027-01-11' });
  });

  it('reads calendar dates, rolling a passed one to next year', () => {
    expect(p('Taxes nov 30')).toMatchObject({ name: 'Taxes', dueOn: '2026-11-30' });
    expect(p('Taxes November 30th')).toMatchObject({ dueOn: '2026-11-30' });
    expect(p('Taxes 30 nov')).toMatchObject({ dueOn: '2026-11-30' });
    expect(p('Taxes apr 15')).toMatchObject({ dueOn: '2027-04-15' });
    expect(p('Taxes apr 15 2028')).toMatchObject({ dueOn: '2028-04-15' });
    expect(p('Taxes 12/1')).toMatchObject({ dueOn: '2026-12-01' });
    expect(p('Taxes 2027-01-05')).toMatchObject({ dueOn: '2027-01-05' });
    expect(p('Taxes feb 30')).toMatchObject({ name: 'Taxes feb 30' }); // no such day: left as typed
  });

  it('reads a time, with or without a date', () => {
    expect(p('Call the dentist tomorrow 9am')).toMatchObject({ name: 'Call the dentist', dueOn: '2026-11-12', dueTime: '09:00' });
    expect(p('Call the dentist tomorrow at 2:30 pm')).toMatchObject({ dueOn: '2026-11-12', dueTime: '14:30' });
    expect(p('Standup 9:15')).toMatchObject({ name: 'Standup', dueOn: '2026-11-11', dueTime: '09:15' });
    expect(p('Lunch noon')).toMatchObject({ dueTime: '12:00' });
    expect(p('Call 12am')).toMatchObject({ dueTime: '00:00' });
  });
});

describe('repeat rules', () => {
  it('reads intervals, starting today when no date is given', () => {
    expect(p('Water plants daily')).toMatchObject({ name: 'Water plants', dueOn: today, repeat: { type: 'days', every: 1 } });
    expect(p('Water plants every 3 days')).toMatchObject({ repeat: { type: 'days', every: 3 } });
    expect(p('Change oil every 6 months')).toMatchObject({ name: 'Change oil', dueOn: today, repeat: { type: 'months', every: 6, day: 11 } });
    expect(p('Renew registration yearly')).toMatchObject({ repeat: { type: 'years', every: 1 } });
    expect(p('Rotate tires every other month')).toMatchObject({ repeat: { type: 'months', every: 2 } });
  });

  it('reads weekly rules on named days and starts on the next of them', () => {
    expect(p('Take the bins out every week on sun')).toMatchObject({ name: 'Take the bins out', dueOn: '2026-11-15', repeat: { type: 'weeks', every: 1, weekdays: [6] } });
    expect(p('Gym every mon, wed and fri')).toMatchObject({ dueOn: '2026-11-11', repeat: { type: 'weeks', weekdays: [0, 2, 4] } });
    expect(p('Report every 2 weeks on thu')).toMatchObject({ dueOn: '2026-11-12', repeat: { type: 'weeks', every: 2, weekdays: [3] } });
    expect(p('Payroll every other fri')).toMatchObject({ repeat: { type: 'weeks', every: 2, weekdays: [4] } });
    expect(p('Standup every weekday 9am')).toMatchObject({ name: 'Standup', dueTime: '09:00', repeat: { weekdays: [0, 1, 2, 3, 4] } });
    expect(p('Weekend chores weekly')).toMatchObject({ repeat: { type: 'weeks', weekdays: [2] } });
    expect(p('weekend sat every week')).toMatchObject({ name: 'weekend', dueOn: '2026-11-14', repeat: { type: 'weeks', weekdays: [5] } });
  });

  it('reads monthly rules on a day or an nth weekday', () => {
    expect(p('Pay rent every month on the 1st')).toMatchObject({ name: 'Pay rent', dueOn: '2026-12-01', repeat: { type: 'months', every: 1, day: 1 } });
    expect(p('Pay rent every 15th')).toMatchObject({ dueOn: '2026-11-15', repeat: { type: 'months', day: 15 } });
    expect(p('Budget every month on the last day')).toMatchObject({ dueOn: '2026-11-30', repeat: { type: 'months', day: -1 } });
    expect(p('Book club every first wed')).toMatchObject({ dueOn: '2026-12-02', repeat: { type: 'monthsNth', every: 1, nth: 1, weekday: 2 } });
    expect(p('Filters every 3 months on the last fri')).toMatchObject({ dueOn: '2026-11-27', repeat: { type: 'monthsNth', every: 3, nth: -1, weekday: 4 } });
  });

  it('reads "after it is done" rules', () => {
    expect(p('Change oil 6 months after done')).toMatchObject({ name: 'Change oil', repeat: { type: 'afterDone', every: 6, unit: 'months' } });
    expect(p("Haircut every 5 weeks after it's done")).toMatchObject({ repeat: { type: 'afterDone', every: 5, unit: 'weeks' } });
    expect(p('Tires 180 days after completion')).toMatchObject({ repeat: { type: 'afterDone', every: 180, unit: 'days' } });
  });

  it('combines a date with a repeat', () => {
    expect(p('Taxes apr 15 every year')).toMatchObject({ name: 'Taxes', dueOn: '2027-04-15', repeat: { type: 'years', every: 1 } });
    expect(p('Pay rent dec 1 monthly')).toMatchObject({ dueOn: '2026-12-01', repeat: { type: 'months', day: 1 } });
  });
});

describe('names left alone', () => {
  it('reads only the end of the text, and keeps a text that is only a date as the name', () => {
    for (const name of ['Buy sun screen', 'Sort small parts', 'Plan the may trip', 'Buy: 8-pack heavy duty J utility hooks (50 lb)', 'Install: J-hooks for ladder, cords, hose', 'Change Oil - Vehicles', 'weekend']) {
      expect(p(name)).toEqual({ name, read: [] });
    }
    expect(p('tomorrow')).toEqual({ name: 'tomorrow', read: [] });
    expect(p('Pay bills fri').read).toEqual(['fri']);
    expect(p('Standup every weekday 9am').read).toEqual(['every weekday', '9am']);
  });
});
