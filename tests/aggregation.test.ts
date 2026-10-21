import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFieldTodayTotal, computeFieldValuesByDay } from '../src/lib/utils/trackableStats';
import { buildTrackableMetrics, computeMetricTable, metricTableToTsv } from '../src/lib/utils/metrics';
import type { FieldDefinition, TrackableDefinition } from '../src/lib/db';

const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

// Field shapes copied from the seeded defaults in db.ts (Water is `sum`,
// Weight has no aggregation so it behaves as `last`).
const water: FieldDefinition = { id: 'f-water', name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum', createdAt: 0, updatedAt: 0 };
const weight: FieldDefinition = { id: 'f-weight', name: 'Weight', kind: 'number', unit: 'lb', createdAt: 0, updatedAt: 0 };
const mood: FieldDefinition = {
  id: 'f-mood',
  name: 'Overall Mood',
  kind: 'rating',
  ratingMin: 1,
  ratingMax: 5,
  aggregation: 'average',
  createdAt: 0,
  updatedAt: 0,
};
const supplements: FieldDefinition = { id: 'f-supp', name: 'Supplements Taken', kind: 'boolean', createdAt: 0, updatedAt: 0 };

afterEach(() => {
  vi.useRealTimers();
});

describe('same-day aggregation', () => {
  const day = local(2026, 7, 30);
  const entries = [
    { timestamp: local(2026, 7, 30, 8), values: { [water.id]: 12, [weight.id]: 181.4, [mood.id]: 3 } },
    { timestamp: local(2026, 7, 30, 12), values: { [water.id]: 16, [mood.id]: 4 } },
    { timestamp: local(2026, 7, 30, 15), values: { [water.id]: 12, [weight.id]: 180.8, [mood.id]: 5 } },
    { timestamp: local(2026, 7, 30, 19), values: { [water.id]: 8 } },
  ];

  it('sums a sum field instead of keeping only one entry', () => {
    expect(computeFieldValuesByDay(entries, water).get(day)).toBe(48);
  });

  it('keeps the latest reading for a last field, whatever the input order', () => {
    expect(computeFieldValuesByDay([...entries].reverse(), weight).get(day)).toBe(180.8);
  });

  it('averages an average field', () => {
    expect(computeFieldValuesByDay(entries, mood).get(day)).toBe(4);
  });

  it("reports today's total for a sum field", () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 7, 30, 21));
    expect(computeFieldTodayTotal(entries, water)).toBe(48);
  });
});

describe('metric table', () => {
  const trackable: TrackableDefinition = {
    id: 't-nutrition',
    name: 'Nutrition',
    icon: 'x',
    color: '#f97316',
    fieldIds: [water.id, supplements.id],
    createdAt: 0,
    updatedAt: 0,
  };
  const entries = [
    { timestamp: local(2026, 10, 12, 9), values: { [water.id]: 40, [supplements.id]: true } },
    { timestamp: local(2026, 10, 12, 18), values: { [water.id]: 20 } },
    { timestamp: local(2026, 10, 14, 9), values: { [water.id]: 30, [supplements.id]: false } },
    { timestamp: local(2026, 10, 19, 9), values: { [water.id]: 50, [supplements.id]: true } },
  ];
  const OCC = 0;
  const WATER = 1;
  const SUPP = 2;

  function build() {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 10, 21, 12));
    return buildTrackableMetrics(trackable, entries, [water, supplements], () => '#000');
  }

  it('rolls weeks up as avg/day over logged days, a count for occurrences, a percent for booleans', () => {
    const metrics = build();
    const table = computeMetricTable(metrics, 'week', local(2026, 10, 12));
    // Newest first: the in-progress week of Oct 19, then the week of Oct 12.
    expect(table.rows.map((r) => r.start)).toEqual([local(2026, 10, 19), local(2026, 10, 12)]);
    expect(table.rows[0].partial).toBe(true);
    const week12 = table.rows[1].cells;
    expect(week12[OCC].value).toBe(3);
    expect(week12[WATER].value).toBe(45); // (60 + 30) / 2 logged days
    expect(week12[SUPP].value).toBe(50); // yes on 1 of 2 logged days
    const week19 = table.rows[0].cells;
    expect(week19[WATER].value).toBe(50);
    expect(week19[WATER].secondary).toBe(5); // change vs the previous week
  });

  it('shows a 7-day rolling average in day view once there are 2 readings', () => {
    const metrics = build();
    const table = computeMetricTable(metrics, 'day', local(2026, 10, 12));
    const row = (d: number) => table.rows.find((r) => r.start === local(2026, 10, d))!;
    expect(row(12).cells[WATER].secondary).toBeNull();
    expect(row(14).cells[WATER].secondary).toBe(45); // Oct 12 (60) and Oct 14 (30)
    expect(row(19).cells[WATER].secondary).toBe(40); // Oct 13-19: Oct 14 (30) and Oct 19 (50)
  });

  it('copies as tab-separated text: a period column, then value and change per metric', () => {
    const metrics = build();
    const tsv = metricTableToTsv(metrics, computeMetricTable(metrics, 'week', local(2026, 10, 12)));
    const [header, newest, older] = tsv.split('\n').map((l) => l.split('\t'));
    expect(header).toHaveLength(1 + metrics.length * 2);
    expect(header.slice(0, 3)).toEqual(['Week of', 'Nutrition (occurrences)', 'Nutrition (occurrences) change']);
    expect(newest[0]).toBe('2026-10-19');
    expect(older[0]).toBe('2026-10-12');
    expect(older[3]).toBe('45'); // Water (Nutrition) avg/day
  });
});
