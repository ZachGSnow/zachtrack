import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import { trackableInsights } from '../src/lib/utils/insights';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';

// America/New_York (vitest config). 2026-10-26 is a Monday.
const NOW = new Date(2026, 9, 26, 20).getTime();
const daysAgo = (n: number, h = 9) => {
  const d = new Date(2026, 9, 26, h);
  d.setDate(d.getDate() - n);
  return d.getTime();
};
const created = daysAgo(100);
const mood: FieldDefinition = { id: 'f-m', name: 'Mood', kind: 'rating', ratingMin: 1, ratingMax: 5, createdAt: 1, updatedAt: 1 };
const base = { id: 't', name: 'Wellness', createdAt: created };

describe('insights', () => {
  it('compares a rating on days with and without another trackable, with day counts', () => {
    // Mood every day for 40 days: 5 on gym days (every other day), 3 otherwise.
    const gym: TimestampedValues[] = [];
    const entries: TimestampedValues[] = [];
    for (let n = 0; n < 40; n++) {
      const gymDay = n % 2 === 0;
      if (gymDay) gym.push({ timestamp: daysAgo(n, 18) });
      entries.push({ timestamp: daysAgo(n, 21), values: { 'f-m': gymDay ? 5 : 3 } });
    }
    const insights = trackableInsights(base, entries, [mood], [{ trackable: { id: 'g', name: 'Gym' }, entries: gym }], NOW);
    const compare = insights.find((i) => i.label === 'On days with')!;
    expect(compare.text).toBe('Mood averages 5 with Gym (20 days), 3 without (20)');
    expect(insights.find((i) => i.label === 'Last 30 days')!.text).toBe('Logged on 30 of 30 days');
  });

  it('leaves out comparisons with too few days on a side, or no real difference', () => {
    const entries: TimestampedValues[] = Array.from({ length: 30 }, (_, n) => ({ timestamp: daysAgo(n), values: { 'f-m': 4 } }));
    const rare = [{ timestamp: daysAgo(1) }, { timestamp: daysAgo(2) }];
    const same = Array.from({ length: 15 }, (_, n) => ({ timestamp: daysAgo(n * 2) }));
    const insights = trackableInsights(base, entries, [mood], [
      { trackable: { id: 'r', name: 'Rare' }, entries: rare },
      { trackable: { id: 's', name: 'Same' }, entries: same },
    ], NOW);
    expect(insights.filter((i) => i.label === 'On days with')).toEqual([]);
  });

  it('ignores a small wobble in a slowly drifting value', () => {
    // Weight drifts down 0.1 lb a day with +-0.3 lb noise; Activity every third day.
    const weight: FieldDefinition = { id: 'f-w', name: 'Weight', kind: 'number', unit: 'lb', createdAt: 1, updatedAt: 1 };
    const noise = [0.3, -0.2, 0.1, -0.3, 0.2, 0];
    const entries: TimestampedValues[] = Array.from({ length: 30 }, (_, n) => ({ timestamp: daysAgo(n), values: { 'f-w': 180 + n * 0.1 + noise[n % 6] } }));
    const activity = Array.from({ length: 10 }, (_, n) => ({ timestamp: daysAgo(n * 3, 18) }));
    const insights = trackableInsights(base, entries, [weight], [{ trackable: { id: 'a', name: 'Activity' }, entries: activity }], NOW);
    expect(insights.filter((i) => i.label === 'On days with')).toEqual([]);
  });

  it('finds the best and worst weekday', () => {
    // Logged every Monday and Wednesday for 12 weeks, plus two Fridays.
    const entries: TimestampedValues[] = [];
    for (let n = 0; n < 84; n++) {
      const weekday = (new Date(daysAgo(n)).getDay() + 6) % 7;
      if (weekday === 0 || weekday === 2 || (weekday === 4 && n < 14)) entries.push({ timestamp: daysAgo(n) });
    }
    const text = trackableInsights(base, entries, [], [], NOW).find((i) => i.label === 'By weekday')!.text;
    expect(text).toMatch(/^Most often on Mons \(12 of 12\), least on (Tue|Thu|Sat|Sun)s \(0 of 12\)$/);
  });

  it('reports a daily goal met over the last 30 scheduled days', () => {
    const goal = { ...base, goalType: 'perDay' as const, goalValue: 1, scheduleDays: [0, 1, 2, 3, 4] };
    const entries: TimestampedValues[] = [];
    for (let n = 0; n < 30; n++) {
      const weekday = (new Date(daysAgo(n)).getDay() + 6) % 7;
      if (weekday < 5 && n % 4 !== 0) entries.push({ timestamp: daysAgo(n) });
    }
    const text = trackableInsights(goal, entries, [], [], NOW).find((i) => i.label === 'Last 30 days')!.text;
    // Sep 27 to Oct 26 has 21 weekdays.
    expect(text).toMatch(/^Goal met on \d+ of 21 days \(\d+%\)$/);
  });
});
