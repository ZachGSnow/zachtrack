import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';
import { describeGoal, goalCardLine, goalStatus } from '../src/lib/utils/trackableGoals';

// America/New_York (vitest config). 2026-10-19 is a Monday; DST ends 2026-11-01.
const at = (month: number, d: number, h = 9) => new Date(2026, month, d, h).getTime();
const oct = (d: number, h = 9) => at(9, d, h);
const T0 = oct(1);
const water: FieldDefinition = { id: 'f-w', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: T0, updatedAt: T0 };
const logs = (...times: number[]): TimestampedValues[] => times.map((timestamp) => ({ timestamp }));

describe('describing a goal', () => {
  it('reads naturally', () => {
    expect(describeGoal({ goalType: 'dailyTotal', goalValue: 64 }, [water])).toBe('64 oz a day (Water)');
    expect(describeGoal({ goalType: 'perWeek', goalValue: 3 }, [])).toBe('3 times a week');
    expect(describeGoal({ goalType: 'everyDays', goalValue: 7 }, [])).toBe('Every 7 days');
    expect(describeGoal({ goalType: 'everyDays', goalValue: 1 }, [])).toBe('Every day');
    expect(describeGoal({ goalType: 'avoid' }, [])).toBe('Avoid it');
    expect(describeGoal({}, [])).toBeNull();
  });
});

describe('daily total', () => {
  const goal = { goalType: 'dailyTotal' as const, goalValue: 64 };
  const drinks = (d: number, ...oz: number[]): TimestampedValues[] => oz.map((v, i) => ({ timestamp: oct(d, 8 + i), values: { 'f-w': v } }));

  it("shows today's progress and counts the days the goal was met", () => {
    const entries = [...drinks(19, 32, 32), ...drinks(20, 40, 30), ...drinks(21, 20)];
    const s = goalStatus(goal, entries, [water], oct(21, 18))!;
    expect(s.text).toBe('20 / 64 oz today');
    expect(s.state).toBe('progress');
    expect(s.progress).toBeCloseTo(20 / 64);
    expect(s.streak).toBe('2 days met');
  });

  it('is done once the total reaches the goal, and the streak includes today', () => {
    const entries = [...drinks(20, 64), ...drinks(21, 30, 40)];
    const s = goalStatus(goal, entries, [water], oct(21, 18))!;
    expect(s).toMatchObject({ state: 'done', progress: 1, streak: '2 days met' });
  });

  it('needs a number field', () => {
    expect(goalStatus(goal, [], [], oct(21))).toBeNull();
  });
});

describe('times per week', () => {
  const goal = { goalType: 'perWeek' as const, goalValue: 3 };

  it('counts days logged since Monday, not entries', () => {
    const s = goalStatus(goal, logs(oct(19, 7), oct(19, 18), oct(21)), [], oct(21, 20))!;
    expect(s.text).toBe('2 of 3 this week');
    expect(s.state).toBe('progress');
  });

  it('is due when every remaining day is needed, and overdue when it can no longer be reached', () => {
    // Saturday 24th, one logged so far: two needed, Saturday and Sunday left.
    expect(goalStatus(goal, logs(oct(19)), [], oct(24, 8))!.state).toBe('due');
    // Sunday 25th, one logged: two needed, only today left.
    expect(goalStatus(goal, logs(oct(19)), [], oct(25, 8))!.state).toBe('overdue');
  });

  it('counts weeks in a row that met the goal', () => {
    const lastTwoWeeks = [oct(5), oct(7), oct(9), oct(12), oct(13), oct(14)];
    expect(goalStatus(goal, logs(...lastTwoWeeks), [], oct(20))!.streak).toBe('2 weeks in a row');
    expect(goalStatus(goal, logs(...lastTwoWeeks, oct(19), oct(20), oct(21)), [], oct(21, 20))!).toMatchObject({
      state: 'done',
      streak: '3 weeks in a row',
    });
  });
});

describe('every N days', () => {
  const goal = { goalType: 'everyDays' as const, goalValue: 7 };

  it('is due by calendar days after the last entry, across the end of DST', () => {
    const last = at(9, 28, 22);
    // Due on Nov 4, seven calendar days after Oct 28, whatever the clock change.
    expect(goalStatus(goal, logs(last), [], at(10, 1, 9))!.text).toBe('Due in 3d');
    expect(goalStatus(goal, logs(last), [], at(10, 3, 9))!.text).toBe('Due tomorrow');
    expect(goalStatus(goal, logs(last), [], at(10, 4, 23))!).toMatchObject({ text: 'Due today', state: 'due' });
    expect(goalStatus(goal, logs(last), [], at(10, 6, 9))!).toMatchObject({ text: 'Overdue by 2d', state: 'overdue', urgency: -2 });
  });

  it('is due straight away with nothing logged, and counts on-time repeats', () => {
    expect(goalStatus(goal, [], [], oct(20))!.state).toBe('due');
    // Gaps of 7, 6 and then 9 days: the latest two were on time.
    const s = goalStatus(goal, logs(oct(1), oct(10), oct(17), oct(23)), [], oct(24))!;
    expect(s.streak).toBe('2 on time');
  });
});

describe('avoid', () => {
  it('uses the time since as the streak, with the best run', () => {
    const s = goalStatus({ goalType: 'avoid' }, logs(oct(1), oct(15), oct(18)), [], oct(20))!;
    expect(s.text).toBe('2d since last');
    expect(s.streak).toBe('best 14d');
    expect(goalCardLine(s, 'avoid', 'ignored')).toMatch(/^2d since last . best 14d$/);
  });
});
