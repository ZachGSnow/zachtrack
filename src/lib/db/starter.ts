// The starter set offered on a fresh install (ARCHITECTURE.md 3.44).

import type { FieldDefinition, TrackableDisplayMode } from './types';
import { db } from './schema';
import { createFieldDefinition, createTrackable } from './records';

// ---------------------------------------------------------------------------
// The starter set (ARCHITECTURE.md 3.44): offered on a fresh install, each
// trackable optional. Fields are shared, so a starter trackable reuses a field
// of the same name when one exists.
// ---------------------------------------------------------------------------

type StarterField = Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt'>;

const STARTER_FIELDS: StarterField[] = [
  { name: 'Weight', kind: 'number', unit: 'lb' },
  { name: 'Waist', kind: 'number', unit: 'in' },
  { name: 'Neck', kind: 'number', unit: 'in' },
  { name: 'Hip', kind: 'number', unit: 'in' },
  { name: 'Chest', kind: 'number', unit: 'in' },
  { name: 'Systolic BP', kind: 'number' },
  { name: 'Diastolic BP', kind: 'number' },
  { name: 'Temperature', kind: 'number', unit: '\u00b0F' },
  { name: 'Calories', kind: 'number', unit: 'kcal', aggregation: 'sum' },
  { name: 'Protein', kind: 'number', unit: 'g', aggregation: 'sum' },
  { name: 'Carbs', kind: 'number', unit: 'g', aggregation: 'sum' },
  { name: 'Fat', kind: 'number', unit: 'g', aggregation: 'sum' },
  { name: 'Caffeine', kind: 'number', unit: 'mg', aggregation: 'sum' },
  { name: 'Alcohol', kind: 'number', unit: 'drinks', aggregation: 'sum' },
  { name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum' },
  { name: 'Supplements Taken', kind: 'boolean' },
  { name: 'Sleep Hours', kind: 'number', unit: 'hrs', aggregation: 'sum' },
  { name: 'Sleep Quality', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Overall Mood', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Stress', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Focus', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Sickness', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Pain', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Bowel Movement', kind: 'rating', ratingMin: 1, ratingMax: 7 },
  { name: 'Duration', kind: 'number', unit: 'min', aggregation: 'sum' },
  { name: 'Exertion', kind: 'rating', ratingMin: 1, ratingMax: 5 },
  { name: 'Calories Burned', kind: 'number', unit: 'kcal', aggregation: 'sum' },
  { name: 'Steps', kind: 'number', aggregation: 'sum' },
  { name: 'Flow', kind: 'rating', ratingMin: 1, ratingMax: 5 },
];

export interface StarterTrackable {
  name: string;
  icon: string;
  color: string;
  /** STARTER_FIELDS names, in order. */
  fields: string[];
  displayMode?: TrackableDisplayMode;
  /** One line for the picker. */
  blurb: string;
}

export const STARTER_TRACKABLES: StarterTrackable[] = [
  { name: 'Body Measurements', icon: '\u2696\ufe0f', color: '#a855f7', fields: ['Weight', 'Waist', 'Neck', 'Hip', 'Chest'], blurb: 'Weight and tape measurements; BMI and body fat follow.' },
  { name: 'Vitals', icon: '\u2764\ufe0f', color: '#ef4444', fields: ['Systolic BP', 'Diastolic BP', 'Temperature'], blurb: 'Blood pressure and temperature.' },
  {
    name: 'Nutrition',
    icon: '\u{1F37D}\ufe0f',
    color: '#f97316',
    fields: ['Calories', 'Protein', 'Carbs', 'Fat', 'Caffeine', 'Alcohol', 'Water', 'Supplements Taken'],
    blurb: 'Calories, macros, caffeine, alcohol, water and supplements.',
  },
  { name: 'Sleep', icon: '\u{1F634}', color: '#818cf8', fields: ['Sleep Hours', 'Sleep Quality'], blurb: 'Hours and quality.' },
  {
    name: 'Wellness Check-in',
    icon: '\u{1F642}',
    color: '#eab308',
    fields: ['Overall Mood', 'Stress', 'Focus', 'Sickness', 'Pain', 'Bowel Movement'],
    blurb: 'Mood, stress, focus, sickness, pain and digestion, 1 to 5.',
  },
  { name: 'Activity', icon: '\u{1F3C3}', color: '#22d3ee', fields: ['Duration', 'Exertion', 'Calories Burned', 'Steps'], blurb: 'Duration, exertion, calories burned and steps.' },
  // Logged with a Flow rating, but the timing between cycles is what matters.
  { name: 'Menstrual Cycle', icon: '\u{1F338}', color: '#ec4899', fields: ['Flow'], displayMode: 'event', blurb: 'Flow, and the time between cycles.' },
  { name: 'Male Health', icon: '\u{1F4A7}', color: '#38bdf8', fields: [], blurb: 'One tap, no fields.' },
];

/** Creates the named starter trackables (and the fields they need) that don't exist yet. */
export async function seedStarterTrackables(names: readonly string[]): Promise<void> {
  const chosen = STARTER_TRACKABLES.filter((t) => names.includes(t.name));
  if (chosen.length === 0) return;
  const existingTrackables = await db.trackableDefinitions.toArray();
  const fieldByName = new Map<string, FieldDefinition>((await db.fieldDefinitions.toArray()).map((f) => [f.name, f] as const));
  const needed = new Set(chosen.flatMap((t) => t.fields));
  for (const spec of STARTER_FIELDS) {
    if (!needed.has(spec.name) || fieldByName.has(spec.name)) continue;
    fieldByName.set(spec.name, await createFieldDefinition(spec));
  }
  for (const spec of chosen) {
    if (existingTrackables.some((t) => t.name === spec.name)) continue;
    await createTrackable({
      name: spec.name,
      icon: spec.icon,
      color: spec.color,
      fieldIds: spec.fields.map((n) => fieldByName.get(n)!.id),
      ...(spec.displayMode ? { displayMode: spec.displayMode } : {}),
    });
  }
}
