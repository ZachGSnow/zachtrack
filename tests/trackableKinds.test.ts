import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../src/lib/db';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';
import { autoKind, dayStreaks, kindStats, resolveKind, summarize } from '../src/lib/utils/trackableKinds';

// Runs in America/New_York (vitest config), so local days and the DST change
// on 2026-11-01 are real.
const at = (month: number, d: number, h = 9) => new Date(2026, month, d, h).getTime();
const oct = (d: number, h = 9) => at(9, d, h);
const T0 = oct(1);
const field = (id: string, name: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id,
  name,
  kind: 'number',
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

const weight = field('f-w', 'Weight', { unit: 'lb' });
const calories = field('f-c', 'Calories', { unit: 'kcal', aggregation: 'sum' });
const mood = field('f-m', 'Mood', { kind: 'rating', ratingMin: 1, ratingMax: 5 });
const took = field('f-t', 'Took vitamins', { kind: 'boolean' });

describe('choosing a kind', () => {
  it('reads it from the first field', () => {
    expect(autoKind([]).kind).toBe('event');
    expect(autoKind([calories, weight]).kind).toBe('daily');
    expect(autoKind([weight, calories]).kind).toBe('measurement');
    expect(autoKind([mood]).kind).toBe('checkin');
    expect(autoKind([took]).kind).toBe('checkin');
    expect(autoKind([weight]).reason).toMatch(/Weight/);
  });

  it('uses an override, and treats occurrences or nothing as automatic', () => {
    expect(resolveKind({ displayMode: 'event' }, [mood])).toMatchObject({ kind: 'event', auto: false });
    expect(resolveKind({ displayMode: 'occurrences' }, [mood])).toMatchObject({ kind: 'checkin', auto: true });
    expect(resolveKind({}, [])).toMatchObject({ kind: 'event', auto: true });
    expect(resolveKind({ displayMode: 'ages' }, [])).toMatchObject({ kind: 'ages', auto: false });
  });
});

describe('summaries', () => {
  it('says so when nothing is logged yet', () => {
    expect(summarize('measurement', [], [weight], oct(20)).card).toBe('No entries yet');
  });

  it('event: time since, and the usual gap from the median', () => {
    const entries = [oct(1), oct(15), oct(29), oct(30)].map((timestamp) => ({ timestamp }));
    const s = summarize('event', entries, [], oct(31, 9));
    // Gaps 14d, 14d, 1d: the median ignores the one short gap.
    expect(s.card).toBe('1d ago \u00b7 usually every 14d');
    expect(s.value).toBe('1d');
  });

  it('measurement: the latest reading and its change over about a week', () => {
    const entries: TimestampedValues[] = [
      { timestamp: oct(10), values: { 'f-w': 181 } },
      { timestamp: oct(14), values: { 'f-w': 180.4 } },
      { timestamp: oct(20), values: { 'f-w': 179.6 } },
      { timestamp: oct(20, 12), values: {} },
    ];
    const s = summarize('measurement', entries, [weight], oct(20, 18));
    expect(s.value).toBe('179.6 lb');
    expect(s.label).toBe('Latest Weight');
    expect(s.sub[0]).toBe('\u25bc0.8 since Oct 14');
    expect(s.card).toMatch(/^179\.6 lb \u00b7 6h ago$/);
  });

  it("daily: today's total and the average of earlier days", () => {
    const entries: TimestampedValues[] = [
      { timestamp: oct(18, 12), values: { 'f-c': 2000 } },
      { timestamp: oct(19, 12), values: { 'f-c': 1800 } },
      { timestamp: oct(20, 8), values: { 'f-c': 500 } },
      { timestamp: oct(20, 13), values: { 'f-c': 700 } },
    ];
    const s = summarize('daily', entries, [calories], oct(20, 18));
    expect(s.value).toMatch(/^1[,.\s\u202f]?200 kcal$/);
    expect(s.card).toMatch(/kcal today$/);
    expect(s.sub[0]).toMatch(/^7-day avg 1[,.\s\u202f]?900 kcal$/);
    expect(summarize('daily', entries, [calories], oct(21, 9)).card).toBe('Nothing today \u00b7 last 20h ago');
  });

  it('check-in: logged today and the streak, or not yet', () => {
    const entries: TimestampedValues[] = [oct(18), oct(19), oct(20)].map((timestamp) => ({ timestamp, values: { 'f-m': 4 } }));
    expect(summarize('checkin', entries, [mood], oct(20, 20)).card).toBe('\u2713 today \u00b7 3-day streak');
    expect(summarize('checkin', entries, [mood], oct(21, 8)).card).toBe('Not yet today \u00b7 last 23h ago');
    expect(summarize('checkin', entries, [mood], oct(20, 20)).sub[1]).toBe('Mood 4 / 5 \u00b7 7-day avg 4');
  });
});

describe('streaks', () => {
  it('count calendar days across the end of daylight saving time', () => {
    const times = [at(9, 30), at(9, 31), at(10, 1), at(10, 2), at(10, 3)];
    expect(dayStreaks(times, at(10, 3, 20))).toEqual({ current: 5, longest: 5 });
  });

  it('keep the current streak alive until the end of today, and remember the longest', () => {
    const times = [oct(1), oct(2), oct(3), oct(4), oct(10), oct(11)];
    expect(dayStreaks(times, oct(12, 8))).toEqual({ current: 2, longest: 4 });
    expect(dayStreaks(times, oct(13, 8))).toEqual({ current: 0, longest: 4 });
  });
});

describe('stat cards', () => {
  it('fit the kind', () => {
    const events = [oct(1), oct(15), oct(29)].map((timestamp) => ({ timestamp }));
    expect(kindStats('event', events, [], oct(30)).map((s) => s.label)).toEqual(['Total', 'Usual gap', 'Longest gap', 'Last 30 days']);
    expect(kindStats('event', events, [], oct(30))[1].value).toBe('14d');
    expect(kindStats('measurement', [], [weight], oct(30)).map((s) => s.label)).toEqual(['Readings', '30-day change', '90-day low', '90-day high']);
    expect(kindStats('checkin', events, [mood], oct(30))[0].label).toBe('Current streak');
  });
});
