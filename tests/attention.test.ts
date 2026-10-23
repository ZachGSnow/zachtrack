import { describe, expect, it } from 'vitest';
import type { TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { attentionItems } from '../src/lib/utils/attention';

const oct = (d: number, h = 9) => new Date(2026, 9, d, h).getTime();
const trackable = (id: string, extra: Partial<TrackableDefinition>): TrackableDefinition => ({
  id,
  name: id,
  icon: 'x',
  color: '#000',
  fieldIds: [],
  createdAt: oct(1),
  updatedAt: oct(1),
  ...extra,
});
const entry = (trackableId: string, timestamp: number): TrackableEntry => ({ id: `${trackableId}-${timestamp}`, trackableId, timestamp, createdAt: timestamp, updatedAt: timestamp });

describe('needs attention', () => {
  it('lists overdue then due goals, and leaves out the rest, archived and goal-less trackables', () => {
    const snapshot = {
      trackables: [
        trackable('Weigh', { goalType: 'everyDays', goalValue: 1 }),
        trackable('Plants', { goalType: 'everyDays', goalValue: 3 }),
        trackable('Gym', { goalType: 'everyDays', goalValue: 7 }),
        trackable('Old', { goalType: 'everyDays', goalValue: 1, archived: true }),
        trackable('Mood', {}),
      ],
      fields: [],
      entries: [entry('Weigh', oct(18)), entry('Plants', oct(19)), entry('Gym', oct(20)), entry('Old', oct(1))],
      recentFasts: [],
      scheduleTime: undefined,
    };
    const items = attentionItems(snapshot, oct(22, 12));
    expect(items.map((i) => [i.name, i.text])).toEqual([
      ['Weigh', 'Overdue by 3d'],
      ['Plants', 'Due today'],
    ]);
  });

  it("lists dates inside their trackable's lead time, after goals due today", () => {
    const dates = { ...trackable('Birthdays', {}), displayMode: 'ages' as const, dateKind: 'birthday' as const, dateLeadDays: 7 };
    const snapshot = {
      trackables: [trackable('Plants', { goalType: 'everyDays', goalValue: 3 }), dates],
      fields: [],
      entries: [
        entry('Plants', oct(19)),
        { ...entry('Birthdays', new Date(1965, 9, 25).getTime()), note: 'Mom' }, // in 3 days
        { ...entry('Birthdays', new Date(1990, 10, 20).getTime()), note: 'Far' }, // in 29 days: not yet
      ],
      recentFasts: [],
      scheduleTime: undefined,
    };
    const items = attentionItems(snapshot, oct(22, 12));
    expect(items.map((i) => [i.name, i.text])).toEqual([
      ['Plants', 'Due today'],
      ['Mom', 'Turns 61 in 3 days'],
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});
