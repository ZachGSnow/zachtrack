import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';
import { describeGoal, goalCardLine, goalStats, goalStatus, habitStrength } from '../src/lib/utils/trackableGoals';

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

describe('times per day', () => {
  const goal = { goalType: 'perDay' as const, goalValue: 3 };

  it('counts entries today and days met in a row', () => {
    const entries = logs(oct(19, 8), oct(19, 12), oct(19, 18), oct(20, 8), oct(20, 9), oct(20, 10), oct(21, 8));
    const s = goalStatus(goal, entries, [], oct(21, 12))!;
    expect(s).toMatchObject({ text: '1 of 3 today', state: 'progress', streak: '2 days met' });
    expect(s.progress).toBeCloseTo(1 / 3);
    expect(describeGoal(goal, [])).toBe('3 times a day');
    expect(describeGoal({ goalType: 'perDay', goalValue: 1 }, [])).toBe('Once a day');
  });
});

describe('schedules, skipped days and pausing', () => {
  // Mon/Wed/Fri only. 2026-10-19 is a Monday.
  const goal = { goalType: 'perDay' as const, goalValue: 1, scheduleDays: [0, 2, 4] };

  it('says the schedule in words', () => {
    expect(describeGoal(goal, [])).toBe('Once a day on Mon, Wed, Fri');
  });

  it("lets rest days pass without breaking the streak, and calls today a rest day", () => {
    const s = goalStatus(goal, logs(oct(12), oct(14), oct(16), oct(19), oct(21)), [], oct(22, 12))!;
    expect(s).toMatchObject({ text: 'Rest day', state: 'ok', streak: '5 days met' });
  });

  it('a missed scheduled day still breaks it', () => {
    expect(goalStatus(goal, logs(oct(12), oct(16), oct(19)), [], oct(20, 12))!.streak).toBe('2 days met');
  });

  it('a skipped day keeps the streak going', () => {
    const daily = { goalType: 'perDay' as const, goalValue: 1 };
    const entries = logs(oct(18), oct(20), oct(21));
    expect(goalStatus(daily, entries, [], oct(21, 20))!.streak).toBe('2 days met');
    expect(goalStatus({ ...daily, skipDays: ['2026-10-19'] }, entries, [], oct(21, 20))!.streak).toBe('3 days met');
  });

  it('while paused nothing is due', () => {
    const paused = { goalType: 'everyDays' as const, goalValue: 2, pausedUntil: new Date(2026, 9, 25).getTime() };
    expect(goalStatus(paused, logs(oct(1)), [], oct(22))).toMatchObject({ text: 'Paused until Oct 25', state: 'ok' });
    expect(goalStatus(paused, logs(oct(1)), [], oct(26))!.state).toBe('overdue');
  });
});

describe('goal stat tiles', () => {
  it('daily: days met in the last 30, the rate, and the current and best runs', () => {
    // Floss once a day since Sep 1: every day except Sep 10 and Oct 3 to 5; today (Oct 21) not yet.
    const skip = new Set([at(8, 10), oct(3), oct(4), oct(5)].map((t) => new Date(t).setHours(0, 0, 0, 0)));
    const times: number[] = [];
    for (let t = at(8, 1); t < oct(21); t = new Date(t).setDate(new Date(t).getDate() + 1)) {
      if (!skip.has(new Date(t).setHours(0, 0, 0, 0))) times.push(t);
    }
    const stats = goalStats({ goalType: 'perDay', goalValue: 1, createdAt: at(8, 1) }, logs(...times), [], oct(21, 10))!;
    expect(stats.map((s) => s.label)).toEqual(['Strength', 'Met, last 30 days', 'Current streak', 'Best streak']);
    expect(stats[0].value).toMatch(/^\d+%$/);
    // Sep 22 to Oct 20 are the 29 finished days in the window; 3 were missed.
    expect(stats[1].value).toBe('26 of 29 (90%)');
    expect(stats[2].value).toBe('15 days'); // Oct 6 to 20
    expect(stats[3].value).toBe('22 days'); // Sep 11 to Oct 2
  });

  it('weekly: this week, weeks met, and runs of weeks', () => {
    // Gym 3 times a week for the three weeks before this one, twice the week before that, once so far this week.
    const times = [
      oct(19), // this week (Mon Oct 19)
      oct(12), oct(14), oct(16),
      oct(5), oct(7), oct(9),
      at(8, 28), at(8, 30), oct(2),
      at(8, 21), at(8, 23),
    ];
    const stats = goalStats({ goalType: 'perWeek', goalValue: 3, createdAt: at(8, 21) }, logs(...times), [], oct(21, 10))!;
    expect(stats.map((s) => s.value).slice(1)).toEqual(['3 of 4', '3 weeks', '3 weeks']);
    expect(stats[0].label).toBe('Strength');
  });

  it('every N days: on-time intervals and runs', () => {
    const times = [oct(1), oct(7), oct(13), oct(22)]; // 6, 6, then 9 days: the last one late
    const stats = goalStats({ goalType: 'everyDays', goalValue: 7, createdAt: oct(1) }, logs(...times), [], oct(23, 10))!;
    expect(stats.map((s) => s.label)).toEqual(['Strength', 'On time (90d)', 'Current streak', 'Best streak']);
    expect(stats[1].value).toBe('2 of 3');
    expect(stats[2].value).toBe('0 on time');
    expect(stats[3].value).toBe('2 on time');
  });

  it('avoid: time since, the best gap, and slips', () => {
    const stats = goalStats({ goalType: 'avoid', createdAt: at(8, 1) }, logs(at(8, 5), oct(1), oct(15)), [], oct(21, 9))!;
    expect(stats.map((s) => s.value)).toEqual(['6d', '26d', '2 slips', '3 slips']);
    expect(goalStats({ goalType: 'avoid', createdAt: at(8, 1) }, [], [], oct(21))![0].value).toBe('Never');
    expect(goalStats({ createdAt: 0 }, [], [], oct(21))).toBeNull();
  });
});

describe('habit strength', () => {
  const daily = { goalType: 'perDay' as const, goalValue: 1, createdAt: at(7, 1) };
  // Every day from Aug 1 to Oct 20, then today (Oct 21) not yet.
  const everyDay = (skip: (t: number) => boolean = () => false) => {
    const times: number[] = [];
    for (let t = at(7, 1); t < oct(21); t = new Date(t).setDate(new Date(t).getDate() + 1)) if (!skip(t)) times.push(t);
    return logs(...times);
  };
  const missed = (...days: number[]) => (t: number) => days.some((d) => new Date(t).getMonth() === 9 && new Date(t).getDate() === d);

  it('climbs with every day met, and today counts only once done', () => {
    const s = habitStrength(daily, everyDay(), [], oct(21, 10))!;
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1);
    expect(habitStrength(daily, [], [], oct(21, 10))).toBe(0);
  });

  it('forgives a missed day: a little lower, not reset', () => {
    const full = habitStrength(daily, everyDay(), [], oct(21, 10))!;
    const oneMiss = habitStrength(daily, everyDay(missed(19)), [], oct(21, 10))!;
    expect(oneMiss).toBeLessThan(full);
    expect(oneMiss).toBeGreaterThan(full - 0.1);
    expect(habitStrength(daily, everyDay(missed(10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)), [], oct(21, 10))!).toBeLessThan(oneMiss - 0.2);
  });

  it('leaves rest days alone, and has nothing for avoid', () => {
    // Weekdays only (0 = Monday), logged on weekdays only: the weekends don't drag it down.
    const weekdays = { ...daily, scheduleDays: [0, 1, 2, 3, 4] };
    const weekdayLogs = everyDay((t) => [0, 6].includes(new Date(t).getDay()));
    expect(habitStrength(weekdays, weekdayLogs, [], oct(21, 10))!).toBeGreaterThan(0.85);
    expect(habitStrength({ goalType: 'avoid', createdAt: 0 }, [], [], oct(21))).toBeNull();
  });
});

