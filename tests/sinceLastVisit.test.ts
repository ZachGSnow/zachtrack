import { describe, expect, it } from 'vitest';
import type { TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { sinceLastVisit } from '../src/lib/utils/sinceLastVisit';

// America/New_York (vitest config). Nov 2 2026 is a Monday.
const nov = (d: number, h = 9) => new Date(2026, 10, d, h).getTime();
const t = (id: string, extra: Partial<TrackableDefinition> = {}): TrackableDefinition => ({
  id,
  name: id,
  icon: 'x',
  color: '#000000',
  fieldIds: [],
  createdAt: nov(1),
  updatedAt: 0,
  ...extra,
});
const e = (trackableId: string, timestamp: number, note?: string): TrackableEntry => ({ id: `${trackableId}${timestamp}`, trackableId, timestamp, note, createdAt: 0, updatedAt: 0 });

const base = { trackables: [] as TrackableDefinition[], fields: [], entries: [] as TrackableEntry[], fasts: [], syncLog: [] };

describe('since you were last here', () => {
  it('says nothing after a short break', () => {
    expect(sinceLastVisit({ ...base, lastActive: nov(5, 9), now: nov(5, 18) })).toEqual([]);
  });

  it('lists missed habit days, a fast that reached its goal, dates that went by and synced changes', () => {
    const lines = sinceLastVisit({
      lastActive: nov(2, 20),
      now: nov(5, 10),
      trackables: [t('Floss', { goalType: 'perDay', goalValue: 1 }), t('Gym', { goalType: 'perWeek', goalValue: 3 }), t('bdays', { displayMode: 'ages', dateKind: 'birthday' })],
      fields: [],
      entries: [e('Floss', nov(3, 21)), e('bdays', new Date(1990, 10, 4).getTime(), 'Alex'), e('bdays', new Date(1990, 10, 20).getTime(), 'Sam')],
      fasts: [{ startTime: nov(2, 20), endTime: nov(3, 13), targetHours: 16, presetLabel: '16:8' }],
      syncLog: [
        { completedAt: nov(4, 8), outcome: 'success', details: ['a', 'b'], moreDetailsCount: 3 },
        { completedAt: nov(1, 8), outcome: 'success', details: ['old'] },
        { completedAt: nov(4, 9), outcome: 'error', details: ['x'] },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      'Your 16:8 fast reached its goal Tuesday at 12:00 PM',
      // Nov 2 (the day you left) and Nov 4 missed; Nov 3 logged; today (Nov 5) still open.
      'Floss: 2 days missed',
      'Alex was Wednesday',
      '5 changes arrived from your other devices',
    ]);
  });

  it('leaves out off days and fasts that ended short', () => {
    const lines = sinceLastVisit({
      ...base,
      lastActive: nov(6, 20),
      now: nov(9, 10),
      trackables: [t('Stretch', { goalType: 'perDay', goalValue: 1, scheduleDays: [0, 1, 2, 3, 4] })], // weekdays only
      fasts: [{ startTime: nov(7, 20), endTime: nov(8, 6), targetHours: 16, presetLabel: '16:8' }],
    });
    // Fri Nov 6 missed; the weekend is rest.
    expect(lines.map((l) => l.text)).toEqual(['Stretch: 1 day missed']);
  });
});
