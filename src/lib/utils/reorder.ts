// The order maths behind drag and drop (ARCHITECTURE.md 3.65), kept apart
// from the pointer handling so it can be tested. Pure; tests/reorder.test.ts.

/** Where a drop at height `y` lands among items whose vertical midpoints are `midpoints` (top to bottom). */
export function dropIndex(midpoints: readonly number[], y: number): number {
  let i = 0;
  while (i < midpoints.length && midpoints[i] < y) i++;
  return i;
}

/** `ids` with `id` taken out (if it's there) and put back at `index`. */
export function moveTo(ids: readonly string[], id: string, index: number): string[] {
  return moveManyTo(ids, [id], index);
}

/**
 * `ids` with every one of `moving` taken out (those that are there) and put
 * back together, in the order given, at `index` among the rest: several
 * selected tasks dragged as one (3.77).
 */
export function moveManyTo(ids: readonly string[], moving: readonly string[], index: number): string[] {
  const out = new Set(moving);
  const rest = ids.filter((x) => !out.has(x));
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * The writes that give `orderedIds` the sort orders 0, 1, 2 ..., leaving out
 * any already in place, so a move writes as few records as it can.
 */
export function renumber(orderedIds: readonly string[], current: ReadonlyMap<string, number | undefined>): Array<{ id: string; sortOrder: number }> {
  return orderedIds.map((id, sortOrder) => ({ id, sortOrder })).filter((c) => current.get(c.id) !== c.sortOrder);
}
