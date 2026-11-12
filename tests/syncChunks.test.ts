import { describe, expect, it } from 'vitest';
import { recordCount, splitForSending } from '../src/lib/utils/syncChunks';

// A sync's send in parts the server takes (ARCHITECTURE.md 3.69).

const changes = (counts: Partial<Record<string, number>>, settings: object | null = null) => ({
  fasts: Array.from({ length: counts.fasts ?? 0 }, (_, i) => ({ id: `f${i}` })),
  fieldDefinitions: Array.from({ length: counts.fieldDefinitions ?? 0 }, (_, i) => ({ id: `d${i}` })),
  trackableDefinitions: Array.from({ length: counts.trackableDefinitions ?? 0 }, (_, i) => ({ id: `t${i}` })),
  trackableEntries: Array.from({ length: counts.trackableEntries ?? 0 }, (_, i) => ({ id: `e${i}` })),
  taskProjects: Array.from({ length: counts.taskProjects ?? 0 }, (_, i) => ({ id: `p${i}` })),
  tasks: Array.from({ length: counts.tasks ?? 0 }, (_, i) => ({ id: `k${i}` })),
  taskCompletions: Array.from({ length: counts.taskCompletions ?? 0 }, (_, i) => ({ id: `c${i}` })),
  settings,
});

describe('splitting a send', () => {
  it('keeps a small send in one part, and an empty one as one empty part', () => {
    const small = changes({ trackableEntries: 3 }, { id: 'app-settings' });
    expect(splitForSending(small, 10)).toEqual([small]);
    expect(splitForSending(changes({}), 10)).toEqual([changes({})]);
  });

  it('cuts a large send into parts of at most the size, in order, losing nothing', () => {
    const big = changes({ fieldDefinitions: 2, trackableDefinitions: 3, trackableEntries: 21, tasks: 4 }, { id: 'app-settings' });
    const parts = splitForSending(big, 10);
    expect(parts.map(recordCount)).toEqual([10, 10, 10, 1]);
    expect(parts[0].settings).toEqual({ id: 'app-settings' });
    expect(parts.slice(1).every((p) => p.settings === null)).toBe(true);
    // Fields and trackables come before entries; entries before tasks.
    expect(parts[0].fieldDefinitions).toHaveLength(2);
    expect(parts[0].trackableDefinitions).toHaveLength(3);
    for (const k of ['fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'tasks'] as const) {
      expect(parts.flatMap((p) => p[k] as unknown[])).toEqual(big[k]);
    }
    expect(recordCount(big)).toBe(31);
  });
});
