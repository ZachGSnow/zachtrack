// What a sync did, in words, for the sync history (stores/sync.svelte.ts).
// Pure functions, so they're unit tested in tests/syncHistory.test.ts.

/** One completed (or failed) sync attempt, kept for the sync history. */
export interface SyncHistoryEntry {
  completedAt: number;
  outcome: 'success' | 'error' | 'offline' | 'local';
  /** e.g. "Sent 2 entries; received 1 fast", or "No changes". */
  summary: string;
  rejectedCount: number;
  /** One readable line per record the server refused and why, capped at REJECTED_DETAILS_LIMIT. */
  rejectedDetails?: string[];
  error?: string;
  /** One line per record received from the server (e.g. "Water (Water: 12 oz) -- Jul 30, 3:15 PM"), capped. */
  details?: string[];
  /** How many received records beyond `details` weren't listed. */
  moreDetailsCount?: number;
  /** One line per record this device sent that the server stored, capped. */
  sentDetails?: string[];
  /** How many sent records beyond `sentDetails` weren't listed. */
  moreSentCount?: number;
  /** How long the sync took. */
  durationMs?: number;
  /** This sync sent the whole dataset (the first sync, an import, Full resync, or the daily check). */
  full?: boolean;
  /** Identical syncs in a row are kept as one entry: how many, and when the first was. */
  repeat?: number;
  firstAt?: number;
}

export type AppliedCounts = Partial<
  Record<'fasts' | 'fieldDefinitions' | 'trackableDefinitions' | 'trackableEntries' | 'settings' | 'deletes', number>
>;

export interface ReceivedCounts {
  fasts: number;
  fieldDefinitions: number;
  trackableDefinitions: number;
  trackableEntries: number;
  settings: boolean;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countParts(c: AppliedCounts): string[] {
  const parts: string[] = [];
  if (c.fasts) parts.push(pluralize(c.fasts, 'fast'));
  if (c.fieldDefinitions) parts.push(pluralize(c.fieldDefinitions, 'field'));
  if (c.trackableDefinitions) parts.push(pluralize(c.trackableDefinitions, 'trackable'));
  if (c.trackableEntries) parts.push(pluralize(c.trackableEntries, 'entry', 'entries'));
  if (c.settings) parts.push('settings');
  if (c.deletes) parts.push(pluralize(c.deletes, 'delete'));
  return parts;
}

/** "Sent 2 entries, 1 delete; received 1 fast", "Received 1 trackable", or "No changes". */
export function summarizeSync(sent: AppliedCounts | undefined, received: ReceivedCounts): string {
  const sentParts = countParts(sent ?? {});
  const receivedParts = countParts({ ...received, settings: received.settings ? 1 : 0 });
  const clauses: string[] = [];
  if (sentParts.length) clauses.push(`Sent ${sentParts.join(', ')}`);
  if (receivedParts.length) clauses.push(`${clauses.length ? 'received' : 'Received'} ${receivedParts.join(', ')}`);
  return clauses.length ? clauses.join('; ') : 'No changes';
}

function hasDetails(e: SyncHistoryEntry): boolean {
  return !!(e.details?.length || e.sentDetails?.length || e.rejectedDetails?.length || e.rejectedCount);
}

/**
 * Adds `entry` to the front of `history` (newest first). When it says the same
 * as the newest entry and neither has details (another "No changes", another
 * "Offline"), the two become one entry with a count, so a quiet day or a long
 * offline stretch doesn't push everything else out.
 */
export function addToHistory(history: SyncHistoryEntry[], entry: SyncHistoryEntry, limit: number): SyncHistoryEntry[] {
  const [head, ...rest] = history;
  if (head && head.outcome === entry.outcome && head.summary === entry.summary && !hasDetails(head) && !hasDetails(entry)) {
    const merged: SyncHistoryEntry = { ...entry, repeat: (head.repeat ?? 1) + 1, firstAt: head.firstAt ?? head.completedAt };
    return [merged, ...rest].slice(0, limit);
  }
  return [entry, ...history].slice(0, limit);
}
