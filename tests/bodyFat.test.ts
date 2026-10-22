import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, getSettings, updateFieldDefinition, type FieldDefinition, type TrackableDefinition } from '../src/lib/db';
import { computeNavyBodyFatByDay, inchesPerUnit, navyBodyFat, resolveBodyFieldIds } from '../src/lib/utils/health';
import { buildNavyBodyFatMetric, buildTrackableMetrics } from '../src/lib/utils/metrics';
import type { TimestampedValues } from '../src/lib/utils/trackableStats';
import { invalidReason } from '../src/lib/validate';

// US Navy circumference method. Reference values worked out separately:
// male waist 34, neck 15, height 70 in -> 17.513 %; female waist 30, hip 38,
// neck 13, height 65 in -> 28.556 %.

const T0 = Date.UTC(2026, 9, 22, 12);
const day = (d: number) => new Date(2026, 9, d).getTime();
const field = (id: string, name: string, unit?: string): FieldDefinition => ({ id, name, kind: 'number', unit, createdAt: T0, updatedAt: T0 });

afterAll(() => db.close());

describe('navyBodyFat', () => {
  it('matches the published formulas', () => {
    expect(navyBodyFat('male', { waistIn: 34, neckIn: 15, heightIn: 70 })).toBeCloseTo(17.513, 2);
    expect(navyBodyFat('female', { waistIn: 30, hipIn: 38, neckIn: 13, heightIn: 65 })).toBeCloseTo(28.556, 2);
  });

  it('gives no estimate for impossible or missing measurements', () => {
    expect(navyBodyFat('male', { waistIn: 15, neckIn: 15, heightIn: 70 })).toBeUndefined();
    expect(navyBodyFat('female', { waistIn: 30, neckIn: 13, heightIn: 65 })).toBeUndefined();
    expect(navyBodyFat('male', { waistIn: 34, neckIn: 15, heightIn: 0 })).toBeUndefined();
  });
});

describe('units', () => {
  it('knows inches and centimetres by their common labels', () => {
    expect(inchesPerUnit('in')).toBe(1);
    expect(inchesPerUnit(' Inches ')).toBe(1);
    expect(inchesPerUnit('cm')).toBeCloseTo(1 / 2.54);
    expect(inchesPerUnit('Millimeters')).toBeCloseTo(1 / 25.4);
    expect(inchesPerUnit('lb')).toBeUndefined();
    expect(inchesPerUnit(undefined)).toBeUndefined();
  });
});

describe('computeNavyBodyFatByDay', () => {
  const waist = { byDay: new Map([[day(1), 86.36], [day(8), 85.5]]), unit: 'cm' };
  const neck = { byDay: new Map([[day(1), 38.1]]), unit: 'cm' };

  it('uses same-day readings, converting cm, and skips days without a neck', () => {
    const byDay = computeNavyBodyFatByDay({ waist, neck }, 'male', 70)!;
    expect([...byDay.keys()]).toEqual([day(1)]);
    // 86.36 cm = 34 in, 38.1 cm = 15 in.
    expect(byDay.get(day(1))).toBeCloseTo(17.513, 2);
  });

  it('shows nothing rather than a wrong number when a unit is not a length', () => {
    expect(computeNavyBodyFatByDay({ waist: { ...waist, unit: undefined }, neck }, 'male', 70)).toBeUndefined();
  });

  it('needs a hip field with a length unit for the female formula', () => {
    expect(computeNavyBodyFatByDay({ waist, neck }, 'female', 65)).toBeUndefined();
    const female = computeNavyBodyFatByDay(
      {
        waist: { byDay: new Map([[day(1), 76.2]]), unit: 'cm' },
        neck: { byDay: new Map([[day(1), 33.02]]), unit: 'cm' },
        hip: { byDay: new Map([[day(1), 96.52]]), unit: 'cm' },
      },
      'female',
      65,
    )!;
    expect(female.get(day(1))).toBeCloseTo(28.556, 2);
  });
});

describe('Navy body fat metric from a trackable', () => {
  const fields = [field('f-weight', 'Weight', 'lb'), field('f-waist', 'Waist', 'in'), field('f-neck', 'Neck', 'in'), field('f-hip', 'Hip', 'in')];
  const trackable: TrackableDefinition = {
    id: 't-body',
    name: 'Body Measurements',
    icon: 'x',
    color: '#a855f7',
    fieldIds: fields.map((f) => f.id),
    createdAt: T0,
    updatedAt: T0,
  };
  const entries: TimestampedValues[] = [
    { timestamp: day(1) + 7 * 3600000, values: { 'f-weight': 180, 'f-waist': 34, 'f-neck': 15, 'f-hip': 40 } },
    { timestamp: day(2) + 7 * 3600000, values: { 'f-weight': 179.5 } },
  ];

  it('finds the fields by name and reports one reading per measuring day', () => {
    const defs = buildTrackableMetrics(trackable, entries, fields, () => '#000', resolveBodyFieldIds(fields, {}));
    const bodyFat = buildNavyBodyFatMetric(defs, 'male', 70)!;
    expect(bodyFat.label).toBe('Body fat (Navy)');
    expect([...bodyFat.valuesByDay.keys()]).toEqual([day(1)]);
    expect(bodyFat.valuesByDay.get(day(1))).toBeCloseTo(17.513, 2);
  });

  it('follows chosen fields over the name fallback', () => {
    const withSecondNeck = [...fields, field('f-neck2', 'Neck (relaxed)', 'in')];
    expect(resolveBodyFieldIds(withSecondNeck, { neckFieldId: 'f-neck2' })).toMatchObject({
      weight: 'f-weight',
      waist: 'f-waist',
      neck: 'f-neck2',
      hip: 'f-hip',
    });
  });

  it('is missing when the trackable has no neck field', () => {
    const noNeck = fields.filter((f) => f.id !== 'f-neck');
    const defs = buildTrackableMetrics(
      { ...trackable, fieldIds: noNeck.map((f) => f.id) },
      entries,
      noNeck,
      () => '#000',
      resolveBodyFieldIds(noNeck, {}),
    );
    expect(buildNavyBodyFatMetric(defs, 'male', 70)).toBeUndefined();
  });
});

describe('renaming a body field', () => {
  beforeEach(async () => {
    await db.fieldDefinitions.clear();
    await db.settings.clear();
    await db.fieldDefinitions.bulkPut([field('f-waist', 'Waist', 'in'), field('f-neck', 'Neck', 'in')]);
  });

  it('pins the renamed field by id so the estimate keeps following it', async () => {
    await updateFieldDefinition('f-neck', { name: 'Neck circumference' });
    const settings = await getSettings();
    expect(settings.neckFieldId).toBe('f-neck');
    expect(settings.waistFieldId).toBeUndefined();
    expect(resolveBodyFieldIds(await db.fieldDefinitions.toArray(), settings).neck).toBe('f-neck');
  });
});

describe('body fat settings validation', () => {
  const settings = { id: 'app-settings', updatedAt: T0 };

  it('accepts field ids and male or female, and refuses anything else', () => {
    expect(invalidReason('settings', { ...settings, waistFieldId: 'a', neckFieldId: 'b', hipFieldId: 'c', bodyFatSex: 'female' })).toBeNull();
    expect(invalidReason('settings', { ...settings, bodyFatSex: 'other' })).toMatch(/bodyFatSex/);
    expect(invalidReason('settings', { ...settings, neckFieldId: 7 })).toMatch(/neckFieldId/);
  });
});
