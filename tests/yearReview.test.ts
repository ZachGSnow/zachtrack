import { describe, expect, it } from 'vitest';
import { reviewYears, yearReview } from '../src/lib/utils/yearReview';

// America/New_York (vitest config).
const d = (y: number, m: number, day: number, h = 20) => new Date(y, m - 1, day, h).getTime();
const H = 3600_000;
const fast = (start: number, hours: number, targetHours = 16) => ({ startTime: start, endTime: start + hours * H, targetHours });
const NOW = d(2026, 10, 23, 12);

const trackables = [
  { id: 'water', name: 'Water', icon: 'w', displayMode: undefined },
  { id: 'gym', name: 'Gym', icon: 'g', displayMode: undefined },
  { id: 'bdays', name: 'Birthdays', icon: 'b', displayMode: 'ages' as const },
];
const entry = (trackableId: string, timestamp: number) => ({ trackableId, timestamp });

describe('year in review', () => {
  it('lists years with data, newest first, with this year always there', () => {
    expect(reviewYears([fast(d(2024, 5, 1), 16)], [entry('water', d(2025, 1, 2))], NOW)).toEqual([2026, 2025, 2024]);
    expect(reviewYears([], [], NOW)).toEqual([2026]);
  });

  it('sums the fasts that started in the year, with the longest goal streak inside it', () => {
    const fasts = [
      fast(d(2025, 12, 31), 16), // last year
      fast(d(2026, 3, 1), 16),
      fast(d(2026, 3, 2), 18),
      fast(d(2026, 3, 3), 10), // short of its goal
      fast(d(2026, 3, 4), 16),
      fast(d(2026, 3, 5), 16),
      fast(d(2026, 3, 6), 36, 36),
    ];
    const r = yearReview(2026, fasts, trackables, [], NOW);
    expect(r.partial).toBe(true);
    expect(r.fasting).toEqual({ fasts: 6, goalFasts: 5, daysFasted: 6, hours: 112, longestHours: 36, longestGoalStreak: 3 });
    expect(r.busiestMonth).toBe('March');
  });

  it('counts logging days per trackable, leaving dates trackables out', () => {
    const entries = [
      entry('water', d(2026, 6, 1, 9)),
      entry('water', d(2026, 6, 1, 15)),
      entry('water', d(2026, 6, 2, 9)),
      entry('gym', d(2026, 6, 2, 18)),
      entry('bdays', d(2026, 6, 3, 0)),
      entry('water', d(2025, 6, 1, 9)),
    ];
    const r = yearReview(2026, [], trackables, entries, NOW);
    expect(r.logging).toEqual({
      entries: 4,
      daysLogged: 2,
      top: [
        { id: 'water', name: 'Water', icon: 'w', days: 2 },
        { id: 'gym', name: 'Gym', icon: 'g', days: 1 },
      ],
    });
    expect(r.busiestMonth).toBe('June');
  });

  it('a past year is complete, and an empty one has no busiest month', () => {
    const r = yearReview(2024, [], trackables, [], NOW);
    expect(r.partial).toBe(false);
    expect(r.busiestMonth).toBeNull();
    expect(r.fasting.fasts).toBe(0);
  });
});
