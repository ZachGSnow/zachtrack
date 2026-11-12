// Splitting a sync's send into parts the server takes in one request each
// (ARCHITECTURE.md 3.69). Pure; tests/syncChunks.test.ts.

/** Records per request the app sends; the server refuses more than MAX_RECORDS_PER_REQUEST (functions/api/sync.ts). */
export const CHUNK_RECORDS = 500;

const LISTS = ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'taskProjects', 'tasks', 'taskCompletions'] as const;
type ListKey = (typeof LISTS)[number];

export type Sendable = { [K in ListKey]: readonly unknown[] } & { settings: unknown | null };

/** How many records `changes` holds (settings counts as one). */
export function recordCount(changes: Sendable): number {
  return LISTS.reduce((n, k) => n + changes[k].length, 0) + (changes.settings ? 1 : 0);
}

/**
 * `changes` cut into parts of at most `size` records, in the order the server
 * applies them (fields before the trackables that use them, projects before
 * their tasks). Settings ride in the first part. Always at least one part,
 * even an empty one, since a sync with nothing to send still pulls.
 */
export function splitForSending<T extends Sendable>(changes: T, size: number = CHUNK_RECORDS): T[] {
  const empty = (): T => ({ ...changes, ...Object.fromEntries(LISTS.map((k) => [k, []])), settings: null }) as T;
  const parts: T[] = [];
  let current = empty();
  let room = size;
  if (changes.settings) {
    current = { ...current, settings: changes.settings };
    room--;
  }
  for (const k of LISTS) {
    let rest = changes[k];
    while (rest.length > 0) {
      if (room === 0) {
        parts.push(current);
        current = empty();
        room = size;
      }
      const take = rest.slice(0, room);
      current = { ...current, [k]: [...current[k], ...take] };
      room -= take.length;
      rest = rest.slice(take.length);
    }
  }
  parts.push(current);
  return parts;
}
