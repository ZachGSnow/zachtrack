import {
  applyRemoteChanges,
  countWaitingChanges,
  db,
  getAllSyncableRecords,
  getChangedSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  onLocalMutation,
  prunePendingTombstones,
  setSyncMeta,
  type FastRecord,
  type FieldDefinition,
  type RemoteSyncChanges,
  type SyncRetryKey,
  type SyncTombstone,
  type TrackableDefinition,
  type TrackableEntry,
} from '../db';
import { formatClockTime, formatDateTime } from '../utils/time';
import { describeRejected, REJECTED_DETAILS_LIMIT, type RejectedRecord } from '../utils/rejected';
import { addToHistory, summarizeSync, type AppliedCounts, type SyncHistoryEntry } from '../utils/syncHistory';

export type { SyncHistoryEntry } from '../utils/syncHistory';

const SYNC_ENDPOINT = '/api/sync';
const DEBOUNCE_MS = 2500;
const HISTORY_STORAGE_KEY = 'zachtrack:sync-history';
const HISTORY_LIMIT = 5;
const HISTORY_DETAILS_LIMIT = 20;
/** A device sends its whole dataset at least this often, in case a change slipped past (a clock set back, a server restore). */
const FULL_SEND_EVERY_MS = 24 * 3600_000;
/** While the app is open and visible, it syncs this often to pick up changes from other devices. */
const AUTO_SYNC_MS = 5 * 60_000;
/** Coming back to the app syncs, unless the last attempt was this recent. */
const RETURN_SYNC_GAP_MS = 30_000;
/** Query param that forces a navigation past the service worker's app-shell fallback (see vite.config.ts). */
const REAUTH_PARAM = 'reauth';

/** `local`: there is no sync server at all (local-only install or `npm run dev`); data stays on the device. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'unauthenticated' | 'local';

class UnauthenticatedError extends Error {
  constructor() {
    super('Login session expired -- log in again to resume syncing.');
    this.name = 'UnauthenticatedError';
  }
}

class NoBackendError extends Error {
  constructor() {
    super('No sync server: your data stays on this device.');
    this.name = 'NoBackendError';
  }
}

interface AppliedRecord {
  recordType: 'fasts' | 'fieldDefinitions' | 'trackableDefinitions' | 'trackableEntries' | 'settings';
  uuid: string;
  deleted?: boolean;
}

interface SyncResponseBody {
  cursor: number;
  changes: RemoteSyncChanges;
  rejected: Array<{ recordType: string; uuid: string; reason: string }>;
  /** Absent from servers before v1.10.0. */
  appliedCounts?: AppliedCounts;
  applied?: AppliedRecord[];
}

const RETRY_TYPES = new Set<string>(['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'settings']);

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

function formatFieldValue(field: FieldDefinition | undefined, value: number | boolean): string {
  if (!field) return String(value);
  if (field.kind === 'boolean') return value ? 'Yes' : 'No';
  if (field.kind === 'rating') return `${value}/${field.ratingMax ?? 5}`;
  return field.unit ? `${value} ${field.unit}` : `${value}`;
}

/** Looks up trackable and field names on this device, for history lines. */
async function nameLookup() {
  const [trackables, fields] = await Promise.all([db.trackableDefinitions.toArray(), db.fieldDefinitions.toArray()]);
  return {
    trackableById: new Map(trackables.map((t) => [t.id, t] as const)),
    fieldById: new Map(fields.map((f) => [f.id, f] as const)),
  };
}

type Names = Awaited<ReturnType<typeof nameLookup>>;

function describeFast(fast: FastRecord): string {
  if (fast.endTime) return `Fast -- ${formatDateTime(fast.startTime)} to ${formatClockTime(fast.endTime)}`;
  return `Fast started -- ${formatDateTime(fast.startTime)}`;
}

function describeEntry(entry: TrackableEntry, names: Names): string {
  const trackableName = names.trackableById.get(entry.trackableId)?.name ?? 'Unknown trackable';
  const values = Object.entries(entry.values ?? {}).map(([fieldId, value]) => {
    const field = names.fieldById.get(fieldId);
    return `${field?.name ?? fieldId}: ${formatFieldValue(field, value)}`;
  });
  const suffix = values.length ? ` (${values.join(', ')})` : '';
  return `${trackableName}${suffix} -- ${formatDateTime(entry.timestamp)}`;
}

/**
 * One line per record received from the server, for the history's detail view.
 * Names come from the local DB, so call this after `applyRemoteChanges`.
 */
async function describeReceived(changes: RemoteSyncChanges): Promise<string[]> {
  const details: string[] = [];
  for (const fast of changes.fasts) {
    details.push(fast.deletedAt ? `Fast deleted -- started ${formatDateTime(fast.startTime)}` : describeFast(fast));
  }
  for (const field of changes.fieldDefinitions) {
    details.push(field.deletedAt ? `Field deleted -- ${field.name}` : `Field -- ${field.name}`);
  }
  for (const trackable of changes.trackableDefinitions) {
    details.push(trackable.deletedAt ? `Trackable deleted -- ${trackable.name}` : `Trackable -- ${trackable.name}`);
  }
  if (changes.trackableEntries.length > 0) {
    const names = await nameLookup();
    for (const entry of changes.trackableEntries) {
      if (entry.deletedAt) {
        details.push(`Entry deleted -- ${names.trackableById.get(entry.trackableId)?.name ?? 'Unknown trackable'}`);
        continue;
      }
      details.push(describeEntry(entry, names));
    }
  }
  if (changes.settings) details.push('Settings updated');
  return details;
}

/** One line per record the server stored from this device (`applied`), named from what was sent. */
async function describeSent(
  applied: AppliedRecord[],
  sent: {
    fasts: FastRecord[];
    fieldDefinitions: FieldDefinition[];
    trackableDefinitions: TrackableDefinition[];
    trackableEntries: TrackableEntry[];
  },
  tombstones: SyncTombstone[],
): Promise<string[]> {
  const names = await nameLookup();
  const deletedLabel = new Map<string, string | undefined>(tombstones.map((t) => [`${t.recordType}:${t.uuid}`, t.label]));
  const byKey = {
    fasts: new Map(sent.fasts.map((f) => [f.uuid, f] as const)),
    fieldDefinitions: new Map(sent.fieldDefinitions.map((f) => [f.id, f] as const)),
    trackableDefinitions: new Map(sent.trackableDefinitions.map((t) => [t.id, t] as const)),
    trackableEntries: new Map(sent.trackableEntries.map((e) => [e.id, e] as const)),
  };
  const kindName = { fasts: 'Fast', fieldDefinitions: 'Field', trackableDefinitions: 'Trackable', trackableEntries: 'Entry', settings: 'Settings' };
  return applied.map((a) => {
    if (a.deleted) {
      const label = deletedLabel.get(`${a.recordType}:${a.uuid}`);
      return `${kindName[a.recordType]} deleted${label ? ` -- ${label}` : ''}`;
    }
    switch (a.recordType) {
      case 'fasts': {
        const fast = byKey.fasts.get(a.uuid);
        return fast ? describeFast(fast) : 'Fast';
      }
      case 'fieldDefinitions':
        return `Field -- ${byKey.fieldDefinitions.get(a.uuid)?.name ?? a.uuid}`;
      case 'trackableDefinitions':
        return `Trackable -- ${byKey.trackableDefinitions.get(a.uuid)?.name ?? a.uuid}`;
      case 'trackableEntries': {
        const entry = byKey.trackableEntries.get(a.uuid);
        return entry ? describeEntry(entry, names) : 'Entry';
      }
      case 'settings':
        return 'Settings updated';
    }
  });
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
  /** Local changes the server doesn't have yet (what the next sync sends). */
  waiting = $state(0);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;
  private syncedListeners: Array<() => void> = [];
  private lastAttemptAt = 0;

  private pushHistory(entry: SyncHistoryEntry): void {
    this.history = addToHistory(this.history, entry, HISTORY_LIMIT);
    saveHistory(this.history);
  }

  /** Recounts `waiting`; cheap enough to run after every local write at this app's scale. */
  async refreshWaiting(): Promise<void> {
    try {
      this.waiting = await countWaitingChanges();
    } catch {
      // Leave the last count; it's informational.
    }
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
      this.unsubscribe = onLocalMutation(() => {
        void this.refreshWaiting();
        this.scheduleSync();
      });
      this.watchForReturn();
    }
    void this.refreshWaiting();
    return outcome;
  }

  /**
   * Syncs when the app comes back into view or the device comes back online,
   * and every few minutes while it's open, so changes made on another device
   * show up without an edit or a restart here.
   */
  private watchForReturn(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncIfStale(RETURN_SYNC_GAP_MS);
    });
    window.addEventListener('online', () => this.syncIfStale(0));
    setInterval(() => {
      if (document.visibilityState === 'visible') this.syncIfStale(AUTO_SYNC_MS / 2);
    }, AUTO_SYNC_MS);
  }

  private syncIfStale(minGapMs: number): void {
    if (this.status === 'local' || this.inFlight) return;
    if (Date.now() - this.lastAttemptAt < minGapMs) return;
    this.syncNow().catch(() => {});
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
    // No server to sync with: don't retry on every edit. A tap on the pill or
    // the next app start checks again.
    if (this.status === 'local') return;
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
    const wasLocalOnly = this.status === 'local';
    const startedAt = Date.now();
    this.lastAttemptAt = startedAt;
    this.status = 'syncing';
    this.lastError = undefined;
    try {
      const meta = await getSyncMeta();
      // Usually only what changed since the last good sync; everything on the
      // first sync, after an import or Full resync, and once a day.
      const full =
        meta.sentThrough == null ||
        meta.lastFullSendAt == null ||
        startedAt - meta.lastFullSendAt >= FULL_SEND_EVERY_MS ||
        (meta.fullSendRequestedAt ?? 0) > meta.lastFullSendAt;
      const [records, tombstones] = await Promise.all([
        full ? getAllSyncableRecords() : getChangedSyncableRecords(meta.sentThrough!, meta.retry),
        getPendingTombstones(),
      ]);

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

      // Refused records go again next time, so they keep showing as not synced
      // until they're fixed or deleted.
      const retry: SyncRetryKey[] = (body.rejected ?? [])
        .filter((r) => RETRY_TYPES.has(r.recordType) && r.uuid)
        .map((r) => ({ recordType: r.recordType as SyncRetryKey['recordType'], uuid: r.uuid }));
      await setSyncMeta({
        cursor: body.cursor,
        lastSyncedAt: Date.now(),
        sentThrough: startedAt,
        retry,
        ...(full ? { lastFullSendAt: startedAt } : {}),
      });

      this.lastSyncedAt = Date.now();
      this.rejected = body.rejected ?? [];
      this.rejectedDetails = this.rejected.length
        ? await describeRejectedLocally(this.rejected).catch(() =>
            this.rejected.map((r) => `${r.recordType} ${r.uuid}: ${r.reason}`),
          )
        : [];
      this.status = 'idle';

      const received = await describeReceived(body.changes).catch(() => [] as string[]);
      const sent = await describeSent(body.applied ?? [], records, tombstones).catch(() => [] as string[]);
      const sentTotal = Object.values(body.appliedCounts ?? {}).reduce((a, b) => a + (b ?? 0), 0);

      this.pushHistory({
        completedAt: this.lastSyncedAt,
        outcome: 'success',
        summary: summarizeSync(body.appliedCounts, {
          fasts: body.changes.fasts.length,
          fieldDefinitions: body.changes.fieldDefinitions.length,
          trackableDefinitions: body.changes.trackableDefinitions.length,
          trackableEntries: body.changes.trackableEntries.length,
          settings: !!body.changes.settings,
        }),
        rejectedCount: this.rejected.length,
        rejectedDetails: this.rejectedDetails.length ? this.rejectedDetails.slice(0, REJECTED_DETAILS_LIMIT) : undefined,
        details: received.slice(0, HISTORY_DETAILS_LIMIT),
        moreDetailsCount: Math.max(0, received.length - HISTORY_DETAILS_LIMIT),
        sentDetails: sent.slice(0, HISTORY_DETAILS_LIMIT),
        moreSentCount: Math.max(0, sentTotal - Math.min(sent.length, HISTORY_DETAILS_LIMIT)),
        durationMs: Date.now() - startedAt,
        ...(full ? { full: true } : {}),
      });
      void this.refreshWaiting();

      const listeners = this.syncedListeners;
      this.syncedListeners = [];
      for (const listener of listeners) listener();
    } catch (err) {
      if (err instanceof NoBackendError) {
        // Not a failure: this install simply has no sync server (local-only
        // use, `npm run dev`). Record it once, not on every edit.
        this.status = 'local';
        if (!wasLocalOnly) {
          this.pushHistory({ completedAt: Date.now(), outcome: 'local', summary: err.message, rejectedCount: 0 });
        }
        throw err;
      }
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
      void this.refreshWaiting();

      throw err;
    }
  }
}

export const syncStore = new SyncStore();
