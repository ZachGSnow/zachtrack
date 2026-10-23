import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import { habitGridMonth, habitGridWeeks } from '../src/lib/utils/habitGrid';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';

// America/New_York (vitest config). 2026-10-19 is a Monday; DST ends 2026-11-01.
const at = (month: number, d: number, h = 9) => new Date(2026, month, d, h).getTime();
const oct = (d: number, h = 9) => at(9, d, h);
const day = (month: number, d: number) => new Date(2026, month, d).getTime();
const created = { createdAt: oct(1) };
const water: FieldDefinition = { id: 'f-w', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: 1, updatedAt: 1 };
const logs = (...times: number[]): TimestampedValues[] => times.map((timestamp) => ({ timestamp }));

describe('habit grid weeks', () => {
  it('is whole weeks, Monday to Sunday, ending with the current week', () => {
    const grid = habitGridWeeks(created, [], [], 3, oct(22, 15));
    expect(grid).toHaveLength(3);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0].day).toBe(day(9, 5));
    expect(grid[2][6].day).toBe(day(9, 25));
    expect(grid[2].find((d) => d.isToday)?.day).toBe(day(9, 22));
    // After today, and before the trackable existed, cells are outside.
    expect(grid[2][6].outside).toBe(true);
  });

  it('keeps calendar days across the end of DST', () => {
    const grid = habitGridWeeks(created, logs(at(10, 1, 23)), [], 2, at(10, 3, 9));
    const days = grid.flat().map((d) => new Date(d.day).getHours());
    expect(new Set(days)).toEqual(new Set([0]));
    expect(grid.flat().find((d) => d.day === day(10, 1))?.count).toBe(1);
  });

  it('without a goal, any entry fills the day', () => {
    const grid = habitGridWeeks(created, logs(oct(20), oct(20, 18)), [], 1, oct(22));
    expect(grid[0][1]).toMatchObject({ day: day(9, 20), count: 2, level: 1 });
    expect(grid[0][0].level).toBe(0);
  });

  it('a daily total shades each day by its share of the goal', () => {
    const entries: TimestampedValues[] = [
      { timestamp: oct(19, 8), values: { 'f-w': 32 } },
      { timestamp: oct(20, 8), values: { 'f-w': 64 } },
      { timestamp: oct(21, 8), values: { 'f-w': 100 } },
    ];
    const week = habitGridWeeks({ ...created, goalType: 'dailyTotal', goalValue: 64 }, entries, [water], 1, oct(22))[0];
    expect(week.slice(0, 3).map((d) => d.level)).toEqual([0.5, 1, 1]);
  });

  it('avoid is inverted: clean days are full', () => {
    const week = habitGridWeeks({ ...created, goalType: 'avoid' }, logs(oct(20)), [], 1, oct(22))[0];
    expect(week.slice(0, 4).map((d) => d.level)).toEqual([1, 0, 1, 1]);
  });

  it('every N days marks the day it fell overdue', () => {
    const goal = { ...created, goalType: 'everyDays' as const, goalValue: 3 };
    const grid = habitGridWeeks(goal, logs(oct(6), oct(9), oct(14)), [], 3, oct(22)).flat();
    const missed = grid.filter((d) => d.missed).map((d) => new Date(d.day).getDate());
    // Oct 6 -> 9 on time; 9 -> 14 overdue on the 12th; after the 14th, overdue on the 17th.
    expect(missed).toEqual([12, 17]);
  });
});

describe('habit grid month', () => {
  it('covers the month in whole weeks as rows', () => {
    const rows = habitGridMonth(created, logs(oct(1)), [], day(9, 1), oct(22));
    // October 2026 starts on a Thursday and ends on a Saturday: Sep 28 to Nov 1, five weeks.
    expect(rows).toHaveLength(5);
    expect(rows[0][0].day).toBe(day(8, 28));
    expect(rows[4][6].day).toBe(day(10, 1));
    expect(rows.flat().find((d) => d.day === day(9, 1))?.count).toBe(1);
  });
});

describe('habit grid with a schedule', () => {
  it('shades times-per-day by count, and draws rest and skipped days as off, not missed', () => {
    const goal = { ...created, goalType: 'perDay' as const, goalValue: 2, scheduleDays: [0, 1, 2, 3, 4], skipDays: ['2026-10-20'] };
    const week = habitGridWeeks(goal, logs(oct(19), oct(21), oct(21, 18)), [], 1, oct(25, 20))[0];
    expect(week.map((d) => d.level)).toEqual([0.5, 0, 1, 0, 0, 0, 0]);
    expect(week.map((d) => d.off)).toEqual([null, 'skipped', null, null, null, 'rest', 'rest']);
  });
});
