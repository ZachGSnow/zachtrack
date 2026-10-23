import type { TrackableDefinition } from '../db';

/**
 * How the Trackables list is ordered. Pinned trackables always come first;
 * archived ones are listed separately (Trackables.svelte).
 * - due:    what needs attention soonest (goal urgency, see trackableGoals.ts), then by name
 * - manual: the order set with the list's up/down buttons (sortOrder), then by name
 * - name:   A to Z
 */
export type ListSort = 'due' | 'manual' | 'name';

export const LIST_SORTS: { id: ListSort; label: string }[] = [
  { id: 'due', label: 'Due first' },
  { id: 'manual', label: 'My order' },
  { id: 'name', label: 'A-Z' },
];

type Listed = Pick<TrackableDefinition, 'id' | 'name' | 'pinned' | 'sortOrder'>;

const byName = (a: Listed, b: Listed) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** `urgency` is the goal status's urgency (lower is sooner), or undefined for no goal. */
export function orderTrackables<T extends Listed>(items: readonly T[], sort: ListSort, urgency: (t: T) => number | undefined): T[] {
  const compare = (a: T, b: T): number => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (sort === 'due') {
      const ua = urgency(a) ?? Number.POSITIVE_INFINITY;
      const ub = urgency(b) ?? Number.POSITIVE_INFINITY;
      if (ua !== ub) return ua - ub;
    } else if (sort === 'manual') {
      const oa = a.sortOrder ?? Number.POSITIVE_INFINITY;
      const ob = b.sortOrder ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
    }
    return byName(a, b);
  };
  return [...items].sort(compare);
}

/**
 * Moves one trackable a step up or down in the manual order and returns the
 * new sortOrder of every trackable whose position changed, numbering the
 * whole list from 0 so trackables without an order get one.
 */
export function moveInOrder(orderedIds: readonly string[], id: string, direction: -1 | 1, current: ReadonlyMap<string, number | undefined>) {
  const ids = [...orderedIds];
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return [];
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids.map((tid, sortOrder) => ({ id: tid, sortOrder })).filter((c) => current.get(c.id) !== c.sortOrder);
}
