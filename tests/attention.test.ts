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
});
