import { describe, expect, it } from 'vitest';
import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { reviewWeekStart, weeklyReview } from '../src/lib/utils/weeklyReview';

// America/New_York (vitest config). Nov 2 2026 is a Monday.
const nov = (d: number, h = 9) => new Date(2026, 10, d, h).getTime();
const oct = (d: number, h = 9) => new Date(2026, 9, d, h).getTime();
const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);

const weight: FieldDefinition = { id: 'w', name: 'Weight', kind: 'number', unit: 'lb', createdAt: 0, updatedAt: 0 };
const t = (id: string, extra: Partial<TrackableDefinition>): TrackableDefinition => ({
  id,
  name: id,
  icon: 'x',
  color: '#000000',
  fieldIds: [],
  createdAt: oct(1),
  updatedAt: 0,
  ...extra,
});
const e = (trackableId: string, timestamp: number, values?: Record<string, number>): TrackableEntry => ({
  id: `${trackableId}${timestamp}`,
  trackableId,
  timestamp,
  values,
  createdAt: 0,
  updatedAt: 0,
});

describe('weekly review', () => {
  it('shows on Sunday (this week) and Monday (last week) only', () => {
    expect(reviewWeekStart(nov(8))).toBe(midnight(nov(2))); // Sunday
    expect(reviewWeekStart(nov(9))).toBe(midnight(nov(2))); // the Monday after
    expect(reviewWeekStart(nov(10))).toBeNull();
    expect(weeklyReview([], [], [], [], undefined, nov(5))).toBeNull();
  });

  it('counts habit days met, the weight average change and fasts for the week just ended', () => {
    const trackables = [t('floss', { goalType: 'perDay', goalValue: 1 }), t('gym', { goalType: 'perWeek', goalValue: 3 }), t('weigh', { fieldIds: ['w'] })];
    const entries = [
      ...[2, 3, 4, 5, 6].map((d) => e('floss', nov(d))), // 5 of 7 days
      ...[3, 5, 7].map((d) => e('gym', nov(d, 18))), // the weekly goal met
      ...[26, 27, 28, 29, 30, 31].map((d) => e('weigh', oct(d), { w: 192 })),
      e('weigh', nov(1), { w: 192 }),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => e('weigh', nov(d), { w: 191 })),
    ];
    const fasts = [
      { startTime: nov(2, 20), endTime: nov(3, 12), targetHours: 16 },
      { startTime: nov(4, 20), endTime: nov(5, 6), targetHours: 16 },
      { startTime: oct(30, 20), endTime: oct(31, 12), targetHours: 16 },
    ];
    const r = weeklyReview(trackables, [weight], entries, fasts, 'w', nov(9, 8))!;
    expect(r.partial).toBe(false);
    expect(r.habits).toEqual({ met: 6, of: 8 });
    expect(r.weight?.average).toBe(191);
    expect(r.weight?.change).toBe(-1);
    expect(r.fasts).toEqual({ count: 2, goal: 1 });
  });

  it('on Sunday counts the week so far, leaving today open until it is met', () => {
    const entries = [2, 3, 4, 5, 6, 7].map((d) => e('floss', nov(d)));
    const r = weeklyReview([t('floss', { goalType: 'perDay', goalValue: 1 })], [], entries, [], undefined, nov(8, 10))!;
    expect(r.partial).toBe(true);
    expect(r.habits).toEqual({ met: 6, of: 6 });
    expect(r.weight).toBeNull();
  });
});
