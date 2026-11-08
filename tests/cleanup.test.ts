import { describe, expect, it } from 'vitest';
import { bodyFieldOptions, fitsBodyRole, unusedFields } from '../src/lib/utils/health';
import { quietTrackables } from '../src/lib/utils/trackableList';

const field = (id: string, name: string, unit?: string, kind = 'number') => ({ id, name, kind, unit });
const fields = [
  field('w', 'Weight', 'lb'),
  field('waist', 'Waist', 'cm'),
  field('neck', 'Neck', 'in'),
  field('hip', 'Hip', 'in'),
  field('grip', 'Grip Strength (left)', 'kg'),
  field('pages', 'Pages', 'pages'),
  field('steps', 'Steps'),
  field('mood', 'Mood', undefined, 'rating'),
];
const trackables = [
  { fieldIds: ['w', 'waist', 'neck', 'hip'], archived: false },
  { fieldIds: ['steps'], archived: true },
];

describe('body field pickers', () => {
  it('matches a role by unit or name', () => {
    expect(fitsBodyRole(field('x', 'Mass', 'kg'), 'weight')).toBe(true);
    expect(fitsBodyRole(field('x', 'Body weight', 'units'), 'weight')).toBe(true);
    expect(fitsBodyRole(field('x', 'Waist', 'cm'), 'waist')).toBe(true);
    expect(fitsBodyRole(field('x', 'Belly', 'in'), 'waist')).toBe(true);
    expect(fitsBodyRole(field('x', 'Pages', 'pages'), 'waist')).toBe(false);
    expect(fitsBodyRole(field('x', 'Weight', 'lb', 'rating'), 'weight')).toBe(false);
  });

  it('offers fitting fields a trackable uses, and leaves orphans out', () => {
    // Grip Strength is in kg but no trackable uses it; Pages fits nothing.
    expect(bodyFieldOptions(fields, trackables, 'weight', undefined).map((f) => f.id)).toEqual(['w']);
    expect(bodyFieldOptions(fields, trackables, 'waist', undefined).map((f) => f.id)).toEqual(['waist', 'neck', 'hip']);
    // The chosen field stays even when it's an orphan or doesn't fit.
    expect(bodyFieldOptions(fields, trackables, 'weight', 'grip').map((f) => f.id)).toEqual(['w', 'grip']);
    expect(bodyFieldOptions(fields, trackables, 'neck', 'steps').map((f) => f.id)).toEqual(['waist', 'neck', 'hip', 'steps']);
  });

  it('falls back to every number field in use when none fits', () => {
    const odd = [field('a', 'Thing', 'units'), field('b', 'Other', 'x'), field('c', 'Note', undefined, 'boolean')];
    expect(bodyFieldOptions(odd, [{ fieldIds: ['a', 'b', 'c'] }], 'weight', undefined).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('lists the fields no trackable uses', () => {
    expect(unusedFields(fields, trackables).map((f) => f.id)).toEqual(['grip', 'pages', 'mood']);
  });
});

describe('quiet trackables', () => {
  const D = 24 * 3600_000;
  const NOW = new Date(2026, 10, 7, 12).getTime();
  const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, createdAt: NOW - 100 * D, ...extra });
  const all = [
    t('sleep'),
    t('nutrition'),
    t('weight'),
    t('pinned', { pinned: true }),
    t('habit', { goalType: 'perDay' }),
    t('dates', { displayMode: 'ages' }),
    t('archived', { archived: true }),
    t('new', { createdAt: NOW - 3 * D }),
  ];
  const entries = [
    { trackableId: 'sleep', timestamp: NOW - 70 * D },
    { trackableId: 'weight', timestamp: NOW - 2 * D },
    { trackableId: 'pinned', timestamp: NOW - 90 * D },
    { trackableId: 'habit', timestamp: NOW - 90 * D },
  ];

  it('finds active goal-less trackables unlogged for six weeks, quietest first', () => {
    // Nutrition was never logged and is 100 days old; Sleep was last logged 70 days ago.
    expect(quietTrackables(all, entries, NOW).map((x) => x.id)).toEqual(['nutrition', 'sleep']);
  });

  it('leaves out pinned, goal, dates, archived and new trackables', () => {
    const ids = quietTrackables(all, entries, NOW).map((x) => x.id);
    for (const id of ['pinned', 'habit', 'dates', 'archived', 'new', 'weight']) expect(ids).not.toContain(id);
  });
});
