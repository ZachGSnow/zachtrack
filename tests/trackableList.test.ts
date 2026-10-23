import { describe, expect, it } from 'vitest';
import { moveInOrder, orderTrackables } from '../src/lib/utils/trackableList';

const t = (id: string, extra: { pinned?: boolean; sortOrder?: number } = {}) => ({ id, name: id, ...extra });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('ordering the trackables list', () => {
  const urgencies: Record<string, number | undefined> = { Water: 100, Weigh: -2, Gym: 10, Mood: undefined, Alpha: undefined };
  const items = [t('Mood'), t('Water'), t('Weigh'), t('Gym'), t('Alpha')];

  it('due first: overdue, then due, then the rest, then no goal by name', () => {
    expect(ids(orderTrackables(items, 'due', (x) => urgencies[x.id]))).toEqual(['Weigh', 'Gym', 'Water', 'Alpha', 'Mood']);
  });

  it('keeps pinned trackables on top in every sort', () => {
    const withPin = [...items.filter((x) => x.id !== 'Mood'), t('Mood', { pinned: true })];
    for (const sort of ['due', 'manual', 'name'] as const) {
      expect(orderTrackables(withPin, sort, (x) => urgencies[x.id])[0].id).toBe('Mood');
    }
  });

  it('my order follows sortOrder, with unordered ones after by name', () => {
    const ordered = [t('Water', { sortOrder: 1 }), t('Gym', { sortOrder: 0 }), t('Mood'), t('Alpha')];
    expect(ids(orderTrackables(ordered, 'manual', () => undefined))).toEqual(['Gym', 'Water', 'Alpha', 'Mood']);
  });

  it('A-Z ignores case', () => {
    expect(ids(orderTrackables([t('b'), t('A'), t('c')], 'name', () => undefined))).toEqual(['A', 'b', 'c']);
  });
});

describe('moving in the manual order', () => {
  it('swaps with the neighbour and numbers the whole list, returning only changes', () => {
    const current = new Map<string, number | undefined>([['a', 0], ['b', 1], ['c', undefined]]);
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1, current)).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ]);
  });

  it('does nothing at either end', () => {
    expect(moveInOrder(['a', 'b'], 'a', -1, new Map())).toEqual([]);
    expect(moveInOrder(['a', 'b'], 'b', 1, new Map())).toEqual([]);
  });
});
