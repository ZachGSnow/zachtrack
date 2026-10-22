import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, getSettings, updateFieldDefinition, updateSettings, type FieldDefinition } from '../src/lib/db';
import { resolveWeightField } from '../src/lib/utils/health';
import { invalidReason } from '../src/lib/validate';

// BMI and the goal line follow one "weight field". It used to be found only by
// the name "Weight", so renaming that field silently turned both off.

const T0 = Date.UTC(2026, 9, 22, 12);
const field = (id: string, name: string, kind: FieldDefinition['kind'] = 'number'): FieldDefinition => ({
  id,
  name,
  kind,
  createdAt: T0,
  updatedAt: T0,
});

afterAll(() => db.close());

describe('resolveWeightField', () => {
  const weight = field('f-weight', 'Weight');
  const scale = field('f-scale', 'Morning scale');

  it('uses the field chosen in settings, whatever its name', () => {
    expect(resolveWeightField([weight, scale], 'f-scale')).toBe(scale);
  });

  it('falls back to the number field named Weight when nothing is chosen', () => {
    expect(resolveWeightField([scale, weight], undefined)).toBe(weight);
    expect(resolveWeightField([field('f-w', ' weight ')], undefined)?.id).toBe('f-w');
  });

  it('falls back to the name when the chosen field is gone or is not a number', () => {
    expect(resolveWeightField([weight], 'f-deleted')).toBe(weight);
    expect(resolveWeightField([weight, field('f-r', 'Mood', 'rating')], 'f-r')).toBe(weight);
  });

  it('finds nothing without a chosen field or a field named Weight', () => {
    expect(resolveWeightField([scale], undefined)).toBeUndefined();
  });
});

describe('renaming the weight field', () => {
  beforeEach(async () => {
    await db.fieldDefinitions.clear();
    await db.settings.clear();
    await db.fieldDefinitions.bulkPut([field('f-weight', 'Weight'), field('f-waist', 'Waist')]);
  });

  it('pins it by id first, so BMI keeps following it under the new name', async () => {
    await updateFieldDefinition('f-weight', { name: 'Body weight' });
    const settings = await getSettings();
    expect(settings.weightFieldId).toBe('f-weight');
    expect(resolveWeightField(await db.fieldDefinitions.toArray(), settings.weightFieldId)?.name).toBe('Body weight');
  });

  it('leaves the setting alone when another field is renamed or only the unit changes', async () => {
    await updateFieldDefinition('f-waist', { name: 'Waist (navel)' });
    await updateFieldDefinition('f-weight', { unit: 'lb' });
    expect((await getSettings()).weightFieldId).toBeUndefined();
  });

  it('keeps a field chosen earlier', async () => {
    await db.fieldDefinitions.put(field('f-scale', 'Scale'));
    await updateSettings({ weightFieldId: 'f-scale' });
    await updateFieldDefinition('f-weight', { name: 'Old weight' });
    expect((await getSettings()).weightFieldId).toBe('f-scale');
  });
});

describe('weightFieldId validation', () => {
  const settings = { id: 'app-settings', updatedAt: T0 };

  it('accepts a field id or nothing, and refuses anything else', () => {
    expect(invalidReason('settings', { ...settings, weightFieldId: 'f-weight' })).toBeNull();
    expect(invalidReason('settings', settings)).toBeNull();
    expect(invalidReason('settings', { ...settings, weightFieldId: 42 })).toMatch(/weightFieldId/);
    expect(invalidReason('settings', { ...settings, weightFieldId: '' })).toMatch(/weightFieldId/);
  });
});
