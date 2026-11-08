import { describe, expect, it } from 'vitest';
import {
  averageStartTime,
  eatingWindowStatus,
  fastGridWeeks,
  fastingWeightInsight,
  fastMonth,
  goalDays,
  goalMet,
  restartSuggestion,
  weekComparison,
  weekStrip,
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

describe('the week strip', () => {
  it('states each day of this week against the plan', () => {
    const now = oct(22, 12); // Thursday
    const fasts = [fast(oct(19, 20), 16, 16), fast(oct(20, 20), 10, 16), fast(oct(22, 8), null, 16)];
    const plan = { defaultPresetId: '16:8', fastScheduleTime: '20:00', fastWeekPlan: [null, null, { rest: true }, null, null, null, { rest: true }] };
    const days = weekStrip(fasts, plan, now);
    expect(days.map((d) => d.state)).toEqual(['goal', 'short', 'rest', 'running', 'upcoming', 'upcoming', 'rest']);
    expect(days[3].isToday).toBe(true);
    // Without a plan: a day with nothing is missed, today is open.
    expect(weekStrip([], undefined, now).map((d) => d.state)).toEqual(['missed', 'missed', 'missed', 'open', 'upcoming', 'upcoming', 'upcoming']);
  });
});

describe('the restart suggestion', () => {
  const presets = [
    { id: '12:12', targetHours: 12 },
    { id: '14:10', targetHours: 14 },
    { id: '16:8', targetHours: 16 },
    { id: '18:6', targetHours: 18 },
    { id: 'custom' },
  ];
  const sept = (d: number, h: number) => new Date(2026, 8, d, h).getTime();

  it('after a fortnight without a goal fast, sums the year and picks a gentler method', () => {
    const now = oct(22, 12);
    const fasts = [fast(sept(1, 20), 18, 18), fast(sept(2, 20), 19, 18), fast(sept(3, 20), 12, 18), fast(sept(4, 20), 17, 18)];
    const s = restartSuggestion(fasts, presets, now)!;
    // Sep 3 and 4 fell short of 18h, so the last goal fast was Sep 2.
    expect(s.daysSince).toBe(50);
    expect(s).toMatchObject({ fasts: 4, goalFasts: 2, usualHours: 18, presetId: '16:8', presetHours: 16 });
    expect(s.averageHours).toBeCloseTo(16.5);
  });

  it('says nothing while fasting is going, with too little history, or with a fast running', () => {
    const now = oct(22, 12);
    const recent = [fast(oct(10, 20), 16, 16), fast(oct(11, 20), 16, 16), fast(oct(12, 20), 16, 16)];
    expect(restartSuggestion(recent, presets, now)).toBeNull();
    expect(restartSuggestion([fast(sept(1, 20), 16, 16), fast(sept(2, 20), 16, 16)], presets, now)).toBeNull();
    const running = [fast(sept(1, 20), 16, 16), fast(sept(2, 20), 16, 16), fast(sept(3, 20), 16, 16), fast(oct(22, 8), null, 16)];
    expect(restartSuggestion(running, presets, now)).toBeNull();
  });

  it('falls back to the shortest method when the usual one is already short, and counts fasts that never met a goal', () => {
    const now = oct(22, 12);
    const short = [fast(sept(1, 20), 10, 12), fast(sept(2, 20), 11, 12), fast(sept(3, 20), 9, 12)];
    const s = restartSuggestion(short, presets, now)!;
    expect(s.daysSince).toBeNull();
    expect(s).toMatchObject({ goalFasts: 0, usualHours: 12, presetId: '12:12' });
  });
});

describe('the History month calendar', () => {
  it('lays a month out in Monday-to-Sunday rows with each week\'s fasts, goal fasts and hours', () => {
    const now = oct(22, 12);
    const fasts = [fast(oct(5, 20), 16, 16), fast(oct(6, 20), 10, 16), fast(oct(20, 20), 18, 16), fast(oct(22, 8), null, 16)];
    const m = fastMonth(fasts, new Date(2026, 9, 1).getTime(), now);
    // October 2026 starts on a Thursday and ends on a Saturday: five rows, Sep 28 to Nov 1.
    expect(m.rows).toHaveLength(5);
    expect(m.rows[0][0].day).toBe(startOfDay(new Date(2026, 8, 28).getTime()));
    expect(m.rows[0][0].outside).toBe(true); // September
    const oct5 = m.rows[1][0];
    expect(oct5.level).toBe(1);
    expect(m.rows[1][1].level).toBeCloseTo(10 / 16);
    expect(m.totals[1]).toEqual({ fasts: 2, goal: 1, hours: 26 });
    // Oct 22's fast started at 8 AM and is 4 hours in: counted to now, not met yet.
    expect(m.totals[3]).toEqual({ fasts: 2, goal: 1, hours: 22 });
    expect(m.rows[3].find((d) => d.isToday)?.level).toBe(0.25);
    // The last row runs Oct 26 to Nov 1, all after today.
    expect(m.rows[4].find((d) => new Date(d.day).getDate() === 26)?.future).toBe(true);
  });
});
