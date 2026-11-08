import { describe, expect, it } from 'vitest';
import { changeTone, describeProjection, describeTrend, goalDirection, projectGoal, rollingAverage, rollingSeries, trendPerWeek, weeklyAverages } from '../src/lib/utils/measurement';
import { addDays, startOfDay } from '../src/lib/utils/time';

// America/New_York (vitest config).
const NOW = new Date(2026, 10, 7, 9).getTime();
const TODAY = startOfDay(NOW);
const day = (n: number) => addDays(TODAY, -n);

/** Values on each of the last `n` days from a function of days-ago. */
function series(n: number, f: (ago: number) => number | null): Map<number, number> {
  const m = new Map<number, number>();
  for (let ago = 0; ago < n; ago++) {
    const v = f(ago);
    if (v != null) m.set(day(ago), v);
  }
  return m;
}

describe('measurement', () => {
  it('averages the last 7 days and the 7 before, skipping days without a reading', () => {
    const byDay = series(14, (ago) => (ago === 3 ? null : ago < 7 ? 190 + ago * 0.1 : 192));
    const a = weeklyAverages(byDay, NOW)!;
    expect(a.current).toBeCloseTo((190 + 190.1 + 190.2 + 190.4 + 190.5 + 190.6) / 6, 5);
    expect(a.previous).toBe(192);
    expect(a.change).toBeCloseTo(a.current - 192, 5);
    expect(rollingAverage(new Map(), NOW)).toBeNull();
    expect(weeklyAverages(series(3, () => 1), NOW)?.previous).toBeNull();
  });

  it('fits a trend per week over 30 days and says nothing with too few points', () => {
    // Losing 0.1 a day, noise-free: 0.7 a week.
    expect(trendPerWeek(series(30, (ago) => 200 + ago * 0.1), NOW)).toBeCloseTo(-0.7, 6);
    // Noise around a flat line nets out.
    expect(Math.abs(trendPerWeek(series(30, (ago) => 190 + (ago % 2 ? 1 : -1)), NOW)!)).toBeLessThan(0.2);
    expect(trendPerWeek(series(4, (ago) => 200 + ago), NOW)).toBeNull();
    // Readings older than the window don't count.
    expect(trendPerWeek(series(60, (ago) => (ago < 30 ? 190 : 100 + ago)), NOW)).toBe(0);
  });

  it('projects a goal from the rate', () => {
    const toward = projectGoal(190, 176, -0.7, NOW);
    expect(toward).toMatchObject({ kind: 'toward', weeks: 20 });
    expect(toward?.kind === 'toward' && toward.at).toBe(addDays(TODAY, 140));
    expect(projectGoal(190, 176, 0.5, NOW)).toEqual({ kind: 'away' });
    expect(projectGoal(190, 176, 0.01, NOW)).toEqual({ kind: 'flat' });
    expect(projectGoal(176.1, 176, -0.7, NOW)).toEqual({ kind: 'there' });
    expect(projectGoal(190, 176, null, NOW)).toBeNull();
    // Five years out is not a forecast.
    expect(projectGoal(300, 176, -0.06, NOW)).toEqual({ kind: 'flat' });
  });

  it('describes trends and projections in words', () => {
    expect(describeTrend(-0.7, 'lb')).toBe('\u25bc0.7 lb/wk over the last 30 days');
    expect(describeTrend(0.03, 'lb')).toBe('About level over the last 30 days');
    expect(describeTrend(null, 'lb')).toBeNull();
    expect(describeProjection({ kind: 'away' }, 176, 'lb')).toBe('Moving away from your goal of 176 lb');
    expect(describeProjection({ kind: 'there' }, 176, 'lb')).toBe('At your goal of 176 lb');
    expect(describeProjection({ kind: 'toward', at: addDays(TODAY, 3), weeks: 0.4 }, 176, 'lb')).toBe('At this rate, 176 lb within the week');
    expect(describeProjection({ kind: 'toward', at: addDays(TODAY, 140), weeks: 20 }, 176, 'lb')).toMatch(/^At this rate, 176 lb around /);
    expect(describeProjection(null, 176, 'lb')).toBeNull();
  });
});

describe('goal direction', () => {
  it('says which way is good, and whether a change goes that way', () => {
    expect(goalDirection(192, 176)).toBe('down');
    expect(goalDirection(150, 160)).toBe('up');
    expect(goalDirection(176.1, 176)).toBeNull();
    expect(goalDirection(null, 176)).toBeNull();
    expect(changeTone(-0.7, 'down')).toBe('good');
    expect(changeTone(0.5, 'down')).toBe('bad');
    expect(changeTone(0.5, 'up')).toBe('good');
    expect(changeTone(0.01, 'down')).toBeNull();
    expect(changeTone(-1, null)).toBeNull();
  });

  it('builds a 7-day average series over given days', () => {
    const byDay = series(14, (ago) => (ago < 7 ? 190 : 194));
    const days = [day(13), day(7), day(6), day(0)];
    // Six days ago the window runs back over six 194 days and one 190 day.
    expect(rollingSeries(byDay, days)).toEqual([194, 194, Math.round(((190 + 194 * 6) / 7) * 100) / 100, 190]);
  });
});
