import { describe, expect, it } from 'vitest';
import type { FieldDefinition, TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { suggestGoals, todayDates, todayHabits, todayLogs } from '../src/lib/utils/today';

// America/New_York (vitest config). A Friday at noon.
const NOW = new Date(2026, 10, 6, 12).getTime();
const H = 3600_000;
const D = 24 * H;

const field = (id: string, name: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id,
  name,
  kind: 'number',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const trackable = (id: string, name: string, extra: Partial<TrackableDefinition> = {}): TrackableDefinition => ({
  id,
  name,
  icon: 'x',
  color: '#22ff88',
  fieldIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const entry = (trackableId: string, timestamp: number, values?: Record<string, number>): TrackableEntry => ({
  id: `${trackableId}-${timestamp}`,
  trackableId,
  timestamp,
  values,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const fields = [field('water', 'Water', { unit: 'oz', aggregation: 'sum' }), field('weight', 'Weight', { unit: 'lb' })];
const trackables = [
  trackable('water', 'Water', { fieldIds: ['water'], goalType: 'dailyTotal', goalValue: 64 }),
  trackable('gym', 'Gym', { goalType: 'perWeek', goalValue: 3 }),
  trackable('floss', 'Floss', { goalType: 'perDay', goalValue: 1 }),
  trackable('stretch', 'Stretch', { goalType: 'perDay', goalValue: 1, scheduleDays: [0, 2] }), // Mon and Wed only
  trackable('weigh', 'Weigh-in', { fieldIds: ['weight'] }),
  trackable('sleep', 'Sleep', { fieldIds: ['weight'] }),
  trackable('old', 'Old habit', { goalType: 'perDay', goalValue: 1, archived: true }),
  trackable('bdays', 'Birthdays', { displayMode: 'ages', dateKind: 'birthday' }),
];
const entries = [
  entry('water', NOW - 2 * H, { water: 20 }),
  entry('floss', NOW - 3 * H),
  entry('weigh', NOW - 2 * D, { weight: 190 }),
  entry('sleep', NOW - 60 * D, { weight: 7 }),
  entry('bdays', new Date(1990, 10, 15).getTime()), // Nov 15: 9 days away
  entry('bdays', new Date(1985, 2, 1).getTime()), // March: not soon
];

describe('Today', () => {
  it('lists every goal trackable, most urgent first, done ones after, rest days last', () => {
    const habits = todayHabits(trackables, fields, entries, NOW);
    expect(habits.map((h) => h.trackable.id)).toEqual(['gym', 'water', 'floss', 'stretch']);
    expect(habits.find((h) => h.trackable.id === 'floss')?.goal?.state).toBe('done');
    expect(habits.find((h) => h.trackable.id === 'water')?.goal?.state).toBe('progress');
    expect(habits.find((h) => h.trackable.id === 'stretch')?.offDay).toBe('rest');
    expect(habits.every((h) => h.trackable.id !== 'old' && h.trackable.id !== 'bdays')).toBe(true);
  });

  it('lists the trackables without a goal that were logged in the last 30 days, latest first', () => {
    const logs = todayLogs(trackables, fields, entries, NOW);
    expect(logs.map((l) => l.trackable.id)).toEqual(['weigh']);
    expect(logs[0].summary).toContain('190');
    expect(logs[0].kind).toBe('measurement');
    // A longer window brings the dormant one back.
    expect(todayLogs(trackables, fields, entries, NOW, 90).map((l) => l.trackable.id)).toEqual(['weigh', 'sleep']);
  });

  it('lists the dates in the next two weeks', () => {
    const dates = todayDates(trackables, entries, NOW);
    expect(dates.map((d) => d.daysUntil)).toEqual([9]);
    expect(todayDates(trackables.filter((t) => t.id !== 'bdays'), entries, NOW)).toEqual([]);
  });
});

describe('goal suggestions', () => {
  const daysAgo = (n: number, h = 8) => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - n);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const list = [
    trackable('check', 'Check-in'),
    trackable('weigh', 'Weigh-in', { fieldIds: ['weight'] }),
    trackable('rare', 'Rare'),
    trackable('goal', 'Has goal', { goalType: 'perDay', goalValue: 1 }),
    trackable('bdays', 'Birthdays', { displayMode: 'ages' }),
  ];
  const logs = [
    ...Array.from({ length: 12 }, (_, i) => entry('check', daysAgo(i))), // 12 of 14 days
    ...[0, 2, 4, 6, 8, 10].map((n) => entry('weigh', daysAgo(n), { weight: 190 })), // every other day
    ...[1, 5].map((n) => entry('rare', daysAgo(n))),
    ...Array.from({ length: 14 }, (_, i) => entry('goal', daysAgo(i))),
    ...Array.from({ length: 14 }, (_, i) => entry('bdays', daysAgo(i))),
  ];

  it('offers once a day to a trackable logged most days, and every N days from the usual gap', () => {
    const s = suggestGoals(list, logs, NOW);
    expect(s.map((x) => [x.trackable.id, x.goalType, x.goalValue, x.label])).toEqual([
      ['check', 'perDay', 1, 'Once a day'],
      ['weigh', 'everyDays', 2, 'Every 2 days'],
    ]);
    expect(s[0].reason).toBe('Logged on 12 of the last 14 days');
  });

  it('leaves out rare ones, ones with a goal, dates and archived ones', () => {
    const ids = suggestGoals([...list, trackable('arch', 'Archived', { archived: true })], [...logs, ...Array.from({ length: 14 }, (_, i) => entry('arch', daysAgo(i)))], NOW).map((x) => x.trackable.id);
    for (const id of ['rare', 'goal', 'bdays', 'arch']) expect(ids).not.toContain(id);
  });
});
