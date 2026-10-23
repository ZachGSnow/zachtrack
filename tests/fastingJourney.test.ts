import { describe, expect, it } from 'vitest';
import {
  averageStartTime,
  eatingWindowStatus,
  fastGridWeeks,
  fastingWeightInsight,
  goalDays,
  goalMet,
  weekComparison,
} from '../src/lib/utils/fastingJourney';
import { computeFastStats } from '../src/lib/utils/stats';
import { addDays, startOfDay } from '../src/lib/utils/time';

// America/New_York (vitest config). Oct 22 2026 is a Thursday.
const oct = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const H = 3600_000;
const fast = (start: number, hours: number | null, targetHours?: number) => ({
  startTime: start,
  endTime: hours == null ? undefined : start + hours * H,
  targetHours,
});

describe('goal met', () => {
  it('a finished fast at or past its target, a count-up fast from 12h, a running one once past it', () => {
    const now = oct(22, 12);
    expect(goalMet(fast(oct(21, 20), 16, 16), now)).toBe(true);
    expect(goalMet(fast(oct(21, 20), 15.9, 16), now)).toBe(false);
    expect(goalMet(fast(oct(21, 0), 12), now)).toBe(true);
    expect(goalMet(fast(oct(21, 0), 0.3), now)).toBe(false);
    expect(goalMet(fast(oct(21, 19), null, 16), now)).toBe(true); // 17h in
    expect(goalMet(fast(oct(22, 8), null, 16), now)).toBe(false);
  });

  it('the streak counts only goal days, so a 20-minute fast no longer keeps it going', () => {
    const now = Date.now();
    const today = startOfDay(now);
    const at = (daysAgo: number) => addDays(today, -daysAgo) + 1 * H;
    const stats = computeFastStats([
      { ...fast(at(3), 16, 16), uuid: 'a', method: 'preset', startDay: 0, createdAt: 1, updatedAt: 1 },
      { ...fast(at(2), 0.3, 16), uuid: 'b', method: 'preset', startDay: 0, createdAt: 1, updatedAt: 1 },
      { ...fast(at(1), 16, 16), uuid: 'c', method: 'preset', startDay: 0, createdAt: 1, updatedAt: 1 },
    ]);
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(1);
    expect(stats.daysFasted30).toBe(3);
  });

  it('goal days are the start days of goal fasts', () => {
    expect([...goalDays([fast(oct(20, 20), 16, 16), fast(oct(21, 20), 2, 16)], oct(23, 12))]).toEqual([startOfDay(oct(20, 20))]);
  });
});

describe('weeks', () => {
  it('averages start times around midnight, not noon', () => {
    expect(averageStartTime([oct(20, 23), oct(21, 1)])).toMatch(/^12:00\sAM$/);
    expect(averageStartTime([oct(20, 19), oct(21, 21)])).toMatch(/^8:00\sPM$/);
    expect(averageStartTime([])).toBeNull();
  });

  it('compares this week (from Monday) with last week', () => {
    const now = oct(22, 12); // Thursday
    const fasts = [fast(oct(13, 20), 16, 16), fast(oct(14, 20), 10, 16), fast(oct(20, 20), 18, 16)];
    const { thisWeek, lastWeek } = weekComparison(fasts, now);
    expect(thisWeek).toMatchObject({ goalFasts: 1, hours: 18 });
    expect(lastWeek).toMatchObject({ goalFasts: 1, hours: 26 });
  });
});

describe('grid', () => {
  it('fills a day by how far its best fast got toward its goal', () => {
    const now = oct(22, 12);
    const weeks = fastGridWeeks([fast(oct(20, 20), 16, 16), fast(oct(21, 20), 8, 16)], 2, now);
    expect(weeks).toHaveLength(2);
    const day = (d: number) => weeks.flat().find((g) => g.day === startOfDay(oct(d, 0)))!;
    expect(day(20).level).toBe(1);
    expect(day(21).level).toBe(0.5);
    expect(day(22)).toMatchObject({ isToday: true, level: 0 });
    expect(day(23)).toMatchObject({ future: true, outside: true });
  });
});

describe('eating window', () => {
  it('is the rest of the day after a fast under 24h, then closed', () => {
    const fasts = [fast(oct(21, 20), 16, 16)]; // ended 12:00 PM Oct 22
    const open = eatingWindowStatus(fasts, oct(22, 14))!;
    expect(open.open).toBe(true);
    expect(open.text).toMatch(/^Eating window: 6h left, until 8:00\sPM$/);
    expect(open.lastFast).toBe('Last fast: 16h, ended 2h ago');
    expect(eatingWindowStatus(fasts, oct(22, 21))!.text).toBe('Eating window closed 1h ago');
  });

  it('says nothing while a fast runs, or a day after the last one', () => {
    expect(eatingWindowStatus([fast(oct(21, 20), 16, 16), fast(oct(22, 20), null, 16)], oct(22, 21))).toBeNull();
    expect(eatingWindowStatus([fast(oct(20, 20), 16, 16)], oct(22, 21))).toBeNull();
  });
});

describe('weight after goal fasts', () => {
  const weights = (values: number[]) => new Map(values.map((v, i) => [startOfDay(oct(1, 12)) + i * 24 * H, v] as const));

  it('says nothing without 5 days on each side', () => {
    expect(fastingWeightInsight([], weights([180, 179.8, 179.6]), 'lb', oct(30, 12))).toBeNull();
  });

  it('reports a clear difference with day counts', () => {
    // Goal fasts start on even days; weight drops after those and holds after the rest.
    const values: number[] = [];
    let w = 180;
    for (let i = 0; i < 20; i++) {
      values.push(Number(w.toFixed(2)));
      w += i % 2 === 0 ? -0.6 + (i % 4) * 0.05 : 0.1 - (i % 3) * 0.05;
    }
    const fasts = Array.from({ length: 10 }, (_, k) => fast(oct(1 + 2 * k, 8), 16, 16));
    const text = fastingWeightInsight(fasts, weights(values), 'lb', oct(30, 12))!;
    expect(text).toMatch(/^Weight changes -0\.\d lb the day after a goal fast \(10 days\), [+-]0\.\d lb after other days \(9\)$/);
  });

  it('ignores a small wobble', () => {
    const values = Array.from({ length: 20 }, (_, i) => 180 + (i % 3) * 0.2);
    const fasts = Array.from({ length: 10 }, (_, k) => fast(oct(1 + 2 * k, 8), 16, 16));
    expect(fastingWeightInsight(fasts, weights(values), 'lb', oct(30, 12))).toBeNull();
  });
});
