import {
  applyRemoteChanges,
  db,
  getAllSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  onLocalMutation,
  prunePendingTombstones,
  setSyncMeta,
  type FieldDefinition,
  type RemoteSyncChanges,
} from '../db';
import { formatClockTime, formatDateTime } from '../utils/time';
import { describeRejected, REJECTED_DETAILS_LIMIT, type RejectedRecord } from '../utils/rejected';

const SYNC_ENDPOINT = '/api/sync';
const DEBOUNCE_MS = 2500;
const HISTORY_STORAGE_KEY = 'zachtrack:sync-history';
const HISTORY_LIMIT = 5;
const HISTORY_DETAILS_LIMIT = 20;
/** Query param that forces a navigation past the service worker's app-shell fallback (see vite.config.ts). */
const REAUTH_PARAM = 'reauth';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'unauthenticated';

class UnauthenticatedError extends Error {
  constructor() {
    super('Login session expired -- log in again to resume syncing.');
    this.name = 'UnauthenticatedError';
  }
}

class NoBackendError extends Error {
  constructor() {
    super('No sync server for this app -- data stays on this device.');
    this.name = 'NoBackendError';
  }
}

interface SyncResponseBody {
  cursor: number;
  changes: RemoteSyncChanges;
  rejected: Array<{ recordType: string; uuid: string; reason: string }>;
}

/** One completed (or failed) sync attempt, kept for the sync-status pill's history popover. */
export interface SyncHistoryEntry {
  completedAt: number;
  outcome: 'success' | 'error' | 'offline';
  /** Human-readable summary of what was pulled from the server, e.g. "2 fasts, 1 entry" or "No changes". */
  summary: string;
  rejectedCount: number;
  /** One readable line per record the server refused and why, capped at REJECTED_DETAILS_LIMIT. */
  rejectedDetails?: string[];
  error?: string;
  /** One line per pulled record, human-readable (e.g. "Water: 12 oz -- Jul 30, 3:15 PM"), capped at HISTORY_DETAILS_LIMIT. */
  details?: string[];
  /** How many additional pulled records beyond `details` weren't included, if any. */
  moreDetailsCount?: number;
}

/** Names each rejected record from what this device has locally (see utils/rejected.ts). */
async function describeRejectedLocally(rejected: RejectedRecord[]): Promise<string[]> {
  const [fasts, entries, trackables, fields] = await Promise.all([
    db.fasts.toArray(),
    db.trackableEntries.toArray(),
    db.trackableDefinitions.toArray(),
    db.fieldDefinitions.toArray(),
  ]);
  return describeRejected(rejected, {
    fasts: new Map(fasts.map((f) => [f.uuid, f] as const)),
    entries: new Map(entries.map((e) => [e.id, e] as const)),
    trackables: new Map(trackables.map((t) => [t.id, t] as const)),
    fields: new Map(fields.map((f) => [f.id, f] as const)),
  });
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Summarizes the deltas pulled from the server in a sync response -- not the (always full-dataset) push. */
function summarizePulledChanges(changes: RemoteSyncChanges): string {
  const parts: string[] = [];
  if (changes.fasts.length) parts.push(pluralize(changes.fasts.length, 'fast'));
  if (changes.fieldDefinitions.length) parts.push(pluralize(changes.fieldDefinitions.length, 'field'));
  if (changes.trackableDefinitions.length) parts.push(pluralize(changes.trackableDefinitions.length, 'trackable'));
  if (changes.trackableEntries.length) parts.push(pluralize(changes.trackableEntries.length, 'entry', 'entries'));
  if (changes.settings) parts.push('settings');
  if (parts.length === 0) return 'No changes';
  return `Pulled ${parts.join(', ')}`;
}

function formatFieldValue(field: FieldDefinition | undefined, value: number | boolean): string {
  if (!field) return String(value);
  if (field.kind === 'boolean') return value ? 'Yes' : 'No';
  if (field.kind === 'rating') return `${value}/${field.ratingMax ?? 5}`;
  return field.unit ? `${value} ${field.unit}` : `${value}`;
}

/**
 * Builds one human-readable line per record pulled from the server, for the sync-history
 * popover's expandable detail view. Looks up trackable/field names against the local DB,
 * so this should be called after `applyRemoteChanges` has already applied `changes`.
 */
async function describePulledChanges(changes: RemoteSyncChanges): Promise<string[]> {
  const details: string[] = [];

  for (const fast of changes.fasts) {
    if (fast.deletedAt) {
      details.push(`Fast deleted -- started ${formatDateTime(fast.startTime)}`);
    } else if (fast.endTime) {
      details.push(`Fast -- ${formatDateTime(fast.startTime)} to ${formatClockTime(fast.endTime)}`);
    } else {
      details.push(`Fast started -- ${formatDateTime(fast.startTime)}`);
    }
  }

  for (const field of changes.fieldDefinitions) {
    details.push(field.deletedAt ? `Field deleted -- ${field.name}` : `Field -- ${field.name}`);
  }

  for (const trackable of changes.trackableDefinitions) {
    details.push(trackable.deletedAt ? `Trackable deleted -- ${trackable.name}` : `Trackable -- ${trackable.name}`);
  }

  if (changes.trackableEntries.length > 0) {
    const [trackables, fields] = await Promise.all([db.trackableDefinitions.toArray(), db.fieldDefinitions.toArray()]);
    const trackableById = new Map(trackables.map((t) => [t.id, t] as const));
    const fieldById = new Map(fields.map((f) => [f.id, f] as const));

    for (const entry of changes.trackableEntries) {
      const trackableName = trackableById.get(entry.trackableId)?.name ?? 'Unknown trackable';
      if (entry.deletedAt) {
        details.push(`Entry deleted -- ${trackableName}`);
        continue;
      }
      const values = Object.entries(entry.values ?? {}).map(([fieldId, value]) => {
        const field = fieldById.get(fieldId);
        return `${field?.name ?? fieldId}: ${formatFieldValue(field, value)}`;
      });
      const suffix = values.length ? ` (${values.join(', ')})` : '';
      details.push(`${trackableName}${suffix} -- ${formatDateTime(entry.timestamp)}`);
    }
  }

  if (changes.settings) {
    details.push('Settings updated');
  }

  return details;
}

function loadHistory(): SyncHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: SyncHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage full or unavailable (e.g. private mode) -- history just won't persist.
  }
}

class SyncStore {
  status = $state<SyncStatus>('idle');
  lastSyncedAt = $state<number | undefined>(undefined);
  lastError = $state<string | undefined>(undefined);
  rejected = $state<Array<{ recordType: string; uuid: string; reason: string }>>([]);
  /** `rejected` as readable lines (record name and reason), for the pill's tooltip and history. */
  rejectedDetails = $state<string[]>([]);
  /** Last few sync attempts (newest first), persisted per-device in localStorage. */
  history = $state<SyncHistoryEntry[]>(loadHistory());

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;
  private syncedListeners: Array<() => void> = [];

  private pushHistory(entry: SyncHistoryEntry): void {
    this.history = [entry, ...this.history].slice(0, HISTORY_LIMIT);
    saveHistory(this.history);
  }

  /**
   * Call once at app startup. Attempts an initial sync pull (best-effort), then watches for local writes.
   *
   * Resolves to `'synced'` when the first sync worked, `'no-backend'` when there is no sync
   * endpoint at all (local-only use, e.g. `npm run dev`), or `'failed'` when there is a backend
   * but it could not be reached right now (offline, login expired). App.svelte only seeds the
   * default trackables after `'synced'` or `'no-backend'`, so a new device that starts offline
   * doesn't create a duplicate default set that the next sync would push to the server.
   */
  async init(): Promise<'synced' | 'no-backend' | 'failed'> {
    this.cleanupReauthUrl();

    const meta = await getSyncMeta();
    this.lastSyncedAt = meta.lastSyncedAt;

    let outcome: 'synced' | 'no-backend' | 'failed';
    try {
      await this.syncNow();
      outcome = 'synced';
    } catch (err) {
      // Local-only usage still works either way.
      outcome = err instanceof NoBackendError ? 'no-backend' : 'failed';
    }

    if (!this.unsubscribe) {
      this.unsubscribe = onLocalMutation(() => this.scheduleSync());
    }
    return outcome;
  }

  /** Runs `listener` once, after the next sync that succeeds. */
  onceSynced(listener: () => void): void {
    this.syncedListeners.push(listener);
  }

  /**
   * Kicks off a fresh Cloudflare Access login by doing a real top-level navigation.
   *
   * A plain reload of the installed PWA never reaches the network -- the service
   * worker serves the precached app shell for every same-origin navigation -- so
   * Access never gets a chance to redirect to its login page. The `?reauth=`
   * marker is denylisted from that fallback in `vite.config.ts`, so this request
   * goes to the edge, Access re-challenges (or silently re-issues the app token
   * if the global session is still valid), and lands back here logged in.
   */
  reauthenticate(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set(REAUTH_PARAM, String(Date.now()));
    window.location.assign(url.toString());
  }

  /**
   * Strips the `?reauth=` marker after landing back from the login flow, so a
   * later reload of this URL goes back to being served offline-capable by the
   * service worker.
   */
  private cleanupReauthUrl(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(REAUTH_PARAM)) return;
    url.searchParams.delete(REAUTH_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  }

  /** Debounced sync trigger used after local writes, so rapid edits batch into one call. */
  scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.syncNow().catch(() => {
        // Errors are already reflected in `status`/`lastError`; nothing else to do here.
      });
    }, DEBOUNCE_MS);
  }

  /** Runs a sync cycle now. Safe to call concurrently -- callers share the in-flight request. */
  async syncNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.doSync();
    this.inFlight = run.finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async doSync(): Promise<void> {
    this.status = 'syncing';
    this.lastError = undefined;
    try {
      const meta = await getSyncMeta();
      const [records, tombstones] = await Promise.all([getAllSyncableRecords(), getPendingTombstones()]);

      const response = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          // Tells Cloudflare Access this is an AJAX call, so an expired session
          // comes back as a plain 401 instead of a 302 to the login page.
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          cursor: meta.cursor,
          changes: records,
          tombstones: tombstones.map(({ recordType, uuid, deletedAt }) => ({ recordType, uuid, deletedAt })),
        }),
      });

      // Access answers an expired session with a 401 (thanks to the
      // X-Requested-With header above). The opaque-redirect check is kept as a
      // fallback: with `redirect: 'manual'`, a re-challenge that still comes as
      // a 302 shows up as status 0 / type 'opaqueredirect' instead of the browser
      // trying (and failing, cross-origin) to follow it -- that's the CORS error
      // this used to surface as. Our own Function never returns 401 (it uses 403).
      if (response.type === 'opaqueredirect' || response.status === 401) {
        throw new UnauthenticatedError();
      }

      // No sync endpoint deployed at all (e.g. the Vite dev server).
      if (response.status === 404 || response.status === 405) {
        throw new NoBackendError();
      }

      if (!response.ok) {
        let detail = '';
        try {
          const errBody = (await response.json()) as { error?: string };
          detail = errBody?.error ? `: ${errBody.error}` : '';
        } catch {
          // Response body wasn't JSON -- ignore.
        }
        throw new Error(`Sync request failed (${response.status})${detail}`);
      }

      const body: SyncResponseBody = await response.json();

      await applyRemoteChanges(body.changes);

      const tombstoneIds = tombstones.map((t) => t.id).filter((id): id is number => id != null);
      await prunePendingTombstones(tombstoneIds);

      await setSyncMeta({ cursor: body.cursor, lastSyncedAt: Date.now() });

      this.lastSyncedAt = Date.now();
      this.rejected = body.rejected ?? [];
      this.rejectedDetails = this.rejected.length
        ? await describeRejectedLocally(this.rejected).catch(() =>
            this.rejected.map((r) => `${r.recordType} ${r.uuid}: ${r.reason}`),
          )
        : [];
      this.status = 'idle';

      const allDetails = await describePulledChanges(body.changes).catch(() => [] as string[]);

      this.pushHistory({
        completedAt: this.lastSyncedAt,
        outcome: 'success',
        summary: summarizePulledChanges(body.changes),
        rejectedCount: this.rejected.length,
        rejectedDetails: this.rejectedDetails.length ? this.rejectedDetails.slice(0, REJECTED_DETAILS_LIMIT) : undefined,
        details: allDetails.slice(0, HISTORY_DETAILS_LIMIT),
        moreDetailsCount: Math.max(0, allDetails.length - HISTORY_DETAILS_LIMIT),
      });

      const listeners = this.syncedListeners;
      this.syncedListeners = [];
      for (const listener of listeners) listener();
    } catch (err) {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const isUnauthenticated = err instanceof UnauthenticatedError;
      this.status = isOffline ? 'offline' : isUnauthenticated ? 'unauthenticated' : 'error';
      this.lastError = err instanceof Error ? err.message : String(err);

      this.pushHistory({
        completedAt: Date.now(),
        outcome: isOffline ? 'offline' : 'error',
        summary: isOffline ? 'Offline -- sync skipped' : isUnauthenticated ? 'Login expired' : 'Sync failed',
        rejectedCount: 0,
        error: this.lastError,
      });

      throw err;
    }
  }
}

export const syncStore = new SyncStore();
