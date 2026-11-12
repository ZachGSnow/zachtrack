import { describe, expect, it } from 'vitest';
import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { sinceLastVisit } from '../src/lib/utils/sinceLastVisit';
import { todayHabits } from '../src/lib/utils/today';
import { orderTrackables } from '../src/lib/utils/trackableList';
import { weeklyReview } from '../src/lib/utils/weeklyReview';

// Years of data (ARCHITECTURE.md 3.68): what Today works out every minute and
// on every write has to stay quick with about ten years of entries. The
// budgets are loose (a slow CI runner passes them easily); the quadratic
// grouping this replaced took several times longer than the budget.

const DAY = 86_400_000;
const now = new Date(2026, 10, 16, 12).getTime(); // a Monday, so the weekly review runs
const fields: FieldDefinition[] = [{ id: 'w', name: 'Weight', kind: 'number', unit: 'lb', createdAt: 0, updatedAt: 0 }];
const trackables: TrackableDefinition[] = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`,
  name: `Trackable ${i}`,
  icon: 'x',
  color: '#38bdf8',
  fieldIds: i === 0 ? ['w'] : [],
  ...(i % 3 === 0 ? { goalType: 'perDay' as const, goalValue: 1 } : i % 3 === 1 ? { goalType: 'everyDays' as const, goalValue: 2 } : {}),
  createdAt: now - 3700 * DAY,
  updatedAt: 0,
}));
// About ten years at six or seven entries a day.
const entries: TrackableEntry[] = Array.from({ length: 24_000 }, (_, i) => ({
  id: `e${i}`,
  trackableId: `t${i % 12}`,
  timestamp: now - Math.floor(i / 6.5) * DAY - (i % 7) * 3_600_000,
  ...(i % 12 === 0 ? { values: { w: 180 + (i % 10) } } : {}),
  createdAt: 0,
  updatedAt: 0,
}));

function time(run: () => unknown): number {
  run(); // warm up
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('ten years of entries', () => {
  it('the weekly review and the away card group entries in linear time', () => {
    expect(weeklyReview(trackables, fields, entries, [], 'w', now)).not.toBeNull();
    expect(time(() => weeklyReview(trackables, fields, entries, [], 'w', now))).toBeLessThan(150);
    expect(time(() => sinceLastVisit({ lastActive: now - 3 * DAY, now, trackables, fields, entries, fasts: [], syncLog: [] }))).toBeLessThan(150);
  });

  it("Today's habits stay quick", () => {
    expect(time(() => todayHabits(trackables, fields, entries, now))).toBeLessThan(250);
  });
});

describe('the due sort', () => {
  it('works out each trackable urgency once, not on both sides of every comparison', () => {
    let calls = 0;
    const order = orderTrackables(trackables, 'due', (t) => {
      calls++;
      return t.goalType ? Number(t.id.slice(1)) : undefined;
    });
    expect(calls).toBe(trackables.length);
    expect(order[0].id).toBe('t0');
  });
});
