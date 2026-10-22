import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, startOfDay } from '../src/lib/utils/time';
import { computeFastStats, filterSinceRange, rangeStartFor } from '../src/lib/utils/stats';
import { computeOccurrenceStats } from '../src/lib/utils/trackableStats';
import type { FastRecord } from '../src/lib/db';

// America/New_York (set in vitest.config.ts): DST ended 2026-11-01 and
// started 2026-03-08, so those days are 25 and 23 hours long.
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function fast(startMs: number, hours: number, n: number): FastRecord {
  return {
    uuid: `fast-${n}`,
    startTime: startMs,
    startDay: startOfDay(startMs),
    endTime: startMs + hours * 3600000,
    method: 'preset',
    presetId: '16:8',
    createdAt: startMs,
    updatedAt: startMs,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('addDays', () => {
  it('stays on local midnight across the fall-back change', () => {
    const oct31 = local(2026, 10, 31);
    expect(addDays(oct31, 1)).toBe(local(2026, 11, 1));
    expect(addDays(oct31, 2)).toBe(local(2026, 11, 2));
    expect(new Date(addDays(oct31, 2)).getHours()).toBe(0);
  });

  it('stays on local midnight across the spring-forward change', () => {
    expect(addDays(local(2026, 3, 7), 2)).toBe(local(2026, 3, 9));
    expect(addDays(local(2026, 3, 9), -2)).toBe(local(2026, 3, 7));
  });
});

describe('streaks across DST', () => {
  it('counts the current fasting streak through the fall-back day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 11, 3, 12));
    const fasts = [30, 31].map((d, i) => fast(local(2026, 10, d, 20), 16, i));
    fasts.push(...[1, 2, 3].map((d, i) => fast(local(2026, 11, d, 20), 16, i + 2)));
    const stats = computeFastStats(fasts);
    expect(stats.currentStreak).toBe(5);
    expect(stats.longestStreak).toBe(5);
  });

  it('counts the longest fasting streak through the spring-forward day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 4, 1, 12));
    const fasts = [6, 7, 8, 9].map((d, i) => fast(local(2026, 3, d, 20), 16, i));
    expect(computeFastStats(fasts).longestStreak).toBe(4);
  });

  it('counts a trackable occurrence streak through the fall-back day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 11, 2, 9));
    const entries = [local(2026, 10, 31, 8), local(2026, 11, 1, 8), local(2026, 11, 2, 8)].map((timestamp) => ({ timestamp }));
    expect(computeOccurrenceStats(entries).currentStreakDays).toBe(3);
  });
});

describe('streaks with a fast in progress', () => {
  // A 16:8 routine: a fast every evening, and last night's is still running
  // at 6 a.m. The streak must not drop to 0 every morning until it ends.
  it('counts the running fast for the day it started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 10, 22, 6));
    const fasts = [17, 18, 19, 20].map((d, i) => fast(local(2026, 10, d, 20), 16, i));
    const running = { ...fast(local(2026, 10, 21, 20), 16, 9), endTime: undefined };
    const stats = computeFastStats([...fasts, running]);
    expect(stats.currentStreak).toBe(5);
    expect(stats.longestStreak).toBe(5);
    // Totals and averages still only count finished fasts.
    expect(stats.totalFasts).toBe(4);
  });

  it('still breaks the streak on a day with no fast at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 10, 22, 6));
    const fasts = [17, 18, 20].map((d, i) => fast(local(2026, 10, d, 20), 16, i));
    const running = { ...fast(local(2026, 10, 21, 20), 16, 9), endTime: undefined };
    expect(computeFastStats([...fasts, running]).currentStreak).toBe(2);
  });
});

describe('ranges', () => {
  it('starts a 7-day range at local midnight after a DST change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 11, 3, 12));
    expect(rangeStartFor('7', [])).toBe(local(2026, 10, 28));
  });

  it('keeps an entry logged just after midnight on the first day of the range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 11, 3, 12));
    const items = [{ t: local(2026, 10, 28, 0, 30) }];
    expect(filterSinceRange(items, '7', (i) => i.t)).toHaveLength(1);
  });
});
