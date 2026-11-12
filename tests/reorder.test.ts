import { describe, expect, it } from 'vitest';
import { dropIndex, moveTo, renumber } from '../src/lib/utils/reorder';

// Drag and drop order (ARCHITECTURE.md 3.65).

describe('drag and drop order', () => {
  it('finds the gap a drop lands in from the items midpoints', () => {
    const mids = [100, 150, 200];
    expect(dropIndex(mids, 50)).toBe(0);
    expect(dropIndex(mids, 120)).toBe(1);
    expect(dropIndex(mids, 199)).toBe(2);
    expect(dropIndex(mids, 300)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });

  it('moves an item within a list, or into one it was not in', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveTo(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(moveTo(['a', 'b'], 'x', 9)).toEqual(['a', 'b', 'x']);
  });

  it('writes only the orders that change', () => {
    const current = new Map<string, number | undefined>([
      ['a', 0],
      ['b', 1],
      ['c', 1794449000000],
      ['d', undefined],
    ]);
    expect(renumber(['a', 'b', 'c', 'd'], current)).toEqual([
      { id: 'c', sortOrder: 2 },
      { id: 'd', sortOrder: 3 },
    ]);
    expect(renumber(['b', 'a'], current)).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
  });
});
