import {
  applyRemoteChanges,
  countLocalRecords,
  countWaitingChanges,
  db,
  eraseLocalData,
  getAllSyncableRecords,
  getDevice,
  getChangedSyncableRecords,
  getPendingTombstones,
  getSyncMeta,
  keepUnsyncedAndReset,
  onLocalMutation,
  prunePendingTombstones,
  setSyncMeta,
  type RemoteSyncChanges,
  type SyncLogRow,
  type SyncRetryKey,
  type SyncRecordType,
} from '../db';
import { describeReceived, describeSent, findOverwritten, type AppliedRecord, type LocalNames } from '../utils/syncDescribe';
import { describeRejected, REJECTED_DETAILS_LIMIT, type RejectedRecord } from '../utils/rejected';
import { canMerge, mergeInto, summarizeSync, type AppliedCounts, type SyncHistoryEntry } from '../utils/syncHistory';
import { splitForSending } from '../utils/syncChunks';

export type { SyncHistoryEntry } from '../utils/syncHistory';

const SYNC_ENDPOINT = '/api/sync';
const ACTIVITY_ENDPOINT = '/api/activity';
const DEVICES_ENDPOINT = '/api/devices';
const DEBOUNCE_MS = 2500;
/** Where the history lived before v1.10.0 (last 5); copied into the syncLog table once. */
const OLD_HISTORY_STORAGE_KEY = 'zachtrack:sync-history';
/** This device keeps its own sync history this long. */
export const HISTORY_DAYS = 30;
/** And at most this many entries, whatever their age. */
const HISTORY_MAX = 2000;
const HISTORY_DETAILS_LIMIT = 20;
/** A device sends its whole dataset at least this often, in case a change slipped past (a clock set back, a server restore). */
const FULL_SEND_EVERY_MS = 24 * 3600_000;
/** While the app is open and visible, it syncs this often to pick up changes from other devices. */
const AUTO_SYNC_MS = 5 * 60_000;
/** Coming back to the app syncs, unless the last attempt was this recent. */
const RETURN_SYNC_GAP_MS = 30_000;
/** Query param that forces a navigation past the service worker's app-shell fallback (see vite.config.ts). */
const REAUTH_PARAM = 'reauth';
/**
 * Cloudflare Access's sign-out page on the app's own domain. It ends the
 * user's Access session, which signs out every device, not just this one.
 * `/cdn-cgi/` is denylisted from the service worker's fallback, so the
 * navigation reaches Cloudflare.
 */
const LOGOUT_URL = '/cdn-cgi/access/logout';

/** `local`: there is no sync server at all (local-only install or `npm run dev`); data stays on the device. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'unauthenticated' | 'local';

class UnauthenticatedError extends Error {
  constructor() {
    super('Login session expired -- log in again to resume syncing.');
    this.name = 'UnauthenticatedError';
  }
}

/** The server no longer keeps deletes this device missed (3.70): reload from it. */
class StaleDeviceError extends Error {
  constructor() {
    super('This device was away so long that it reloads from the server.');
    this.name = 'StaleDeviceError';
  }
}

class NoBackendError extends Error {
  constructor() {
    super('No sync server: your data stays on this device.');
    this.name = 'NoBackendError';
  }
}

/** A sync stops after this many requests, sending or pulling; the next sync carries on from where it got to. */
const MAX_REQUESTS_PER_SYNC = 200;

const emptyLists = () => ({ fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], taskProjects: [], tasks: [], taskCompletions: [] });

/** Adds one response's changes to what the sync has received so far (for the history). */
function mergeChanges(into: RemoteSyncChanges, more: RemoteSyncChanges) {
  into.fasts.push(...more.fasts);
  into.fieldDefinitions.push(...more.fieldDefinitions);
  into.trackableDefinitions.push(...more.trackableDefinitions);
  into.trackableEntries.push(...more.trackableEntries);
  into.taskProjects!.push(...(more.taskProjects ?? []));
  into.tasks!.push(...(more.tasks ?? []));
  into.taskCompletions!.push(...(more.taskCompletions ?? []));
  if (more.settings) into.settings = more.settings;
}

/** A device in the server's list (functions/api/sync.ts). */
export interface DeviceInfo {
  id: string;
  name: string;
  appVersion?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** One sync that changed something, from any device (functions/api/activity.ts). */
export interface ActivityEvent {
  id: number;
  deviceId: string;
  at: number;
  counts: AppliedCounts;
  details: string[];
  rejectedCount: number;
}

interface SyncResponseBody {
  cursor: number;
  /** More changes wait after `cursor` (3.69): pull again. */
  more?: boolean;
  changes: RemoteSyncChanges;
  rejected: Array<{ recordType: string; uuid: string; reason: string }>;
  /** Absent from servers before v1.10.0. */
  appliedCounts?: AppliedCounts;
  applied?: AppliedRecord[];
  devices?: DeviceInfo[];
  /** Live records per type on the server, when the request asked to check. */
  counts?: Partial<Record<SyncRecordType, number>>;
}

/** What Check sync found: this device's records against the server's, per type. */
export interface CheckResult {
  at: number;
  rows: Array<{ label: string; here: number; server: number }>;
  matches: boolean;
  /** Records the server refused, which stay on this device only and explain a difference. */
  rejected: number;
  /** The server is older than v1.10.0 and can't count. */
  unsupported?: boolean;
}

const CHECK_LABELS: Record<SyncRecordType, string> = {
  fasts: 'Fasts',
  fieldDefinitions: 'Fields',
  trackableDefinitions: 'Trackables',
  trackableEntries: 'Entries',
  taskProjects: 'Projects',
  tasks: 'Tasks',
  taskCompletions: 'Task completions',
};

/** Calls an /api endpoint the way sync does, mapping an expired login to UnauthenticatedError. */
async function callApi(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    redirect: 'manual',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init.headers ?? {}) },
  });
  if (response.type === 'opaqueredirect' || response.status === 401) throw new UnauthenticatedError();
  if (response.status === 404 || response.status === 405) throw new NoBackendError();
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response;
}

const RETRY_TYPES = new Set<string>(['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'taskProjects', 'tasks', 'taskCompletions', 'settings']);

/** Names each rejected record from what this device has locally (see utils/rejected.ts). */
async function describeRejectedLocally(rejected: RejectedRecord[]): Promise<string[]> {
  const [fasts, entries, trackables, fields, projects, tasks] = await Promise.all([
    db.fasts.toArray(),
    db.trackableEntries.toArray(),
    db.trackableDefinitions.toArray(),
    db.fieldDefinitions.toArray(),
    db.taskProjects.toArray(),
    db.tasks.toArray(),
  ]);
  return describeRejected(rejected, {
    fasts: new Map(fasts.map((f) => [f.uuid, f] as const)),
    entries: new Map(entries.map((e) => [e.id, e] as const)),
    trackables: new Map(trackables.map((t) => [t.id, t] as const)),
    fields: new Map(fields.map((f) => [f.id, f] as const)),
    projects: new Map(projects.map((p) => [p.id, p] as const)),
    tasks: new Map(tasks.map((t) => [t.id, t] as const)),
  });
}

/** Trackable, field and task names on this device, for history lines. */
async function localNames(): Promise<LocalNames> {
  const [trackables, fields, tasks] = await Promise.all([db.trackableDefinitions.toArray(), db.fieldDefinitions.toArray(), db.tasks.toArray()]);
  return {
    trackableById: new Map(trackables.map((t) => [t.id, t] as const)),
    fieldById: new Map(fields.map((f) => [f.id, f] as const)),
    taskNameById: new Map(tasks.map((t) => [t.id, t.name] as const)),
  };
}

/** Reads this device's history (newest first), first copying in the pre-v1.10.0 entries from localStorage. */
async function loadHistory(): Promise<SyncLogRow[]> {
  try {
    const old = typeof localStorage === 'undefined' ? null : localStorage.getItem(OLD_HISTORY_STORAGE_KEY);
    if (old) {
      const parsed = JSON.parse(old);
      if (Array.isArray(parsed)) await db.syncLog.bulkAdd(parsed as SyncLogRow[]);
      localStorage.removeItem(OLD_HISTORY_STORAGE_KEY);
    }
  } catch {
    // An unreadable old history just isn't copied.
  }
  return (await db.syncLog.orderBy('completedAt').reverse().toArray()).filter(
    (e) => e.completedAt >= Date.now() - HISTORY_DAYS * 24 * 3600_000,
  );
}

class SyncStore {
  status = $state<SyncStatus>('idle');
  lastSyncedAt = $state<number | undefined>(undefined);
  lastError = $state<string | undefined>(undefined);
  rejected = $state<Array<{ recordType: string; uuid: string; reason: string }>>([]);
  /** `rejected` as readable lines (record name and reason), for the pill's tooltip and history. */
  rejectedDetails = $state<string[]>([]);
  /** This device's sync attempts over the last HISTORY_DAYS (newest first), kept in its syncLog table. */
  history = $state<SyncLogRow[]>([]);
  /** Local changes the server doesn't have yet (what the next sync sends). */
  waiting = $state(0);
  /** This device's id and name in the server's device list. */
  deviceId = $state<string | undefined>(undefined);
  deviceName = $state<string | undefined>(undefined);
  /** Every device that has synced in the last 90 days, from the last sync or activity read. */
  devices = $state<DeviceInfo[]>([]);
  /** Signed out with Sign out (not just an expired login), until the next good sync. */
  signedOut = $state(false);
  /** The last Check sync's result. */
  lastCheck = $state<CheckResult | undefined>(undefined);

  private checkRequested = false;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;
  private syncedListeners: Array<() => void> = [];
  private lastAttemptAt = 0;

  /** Adds a history entry, or folds it into the newest one when it says the same (utils/syncHistory.ts). */
  private async pushHistory(entry: SyncHistoryEntry): Promise<void> {
    const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600_000;
    const [head, ...rest] = this.history;
    try {
      if (canMerge(head, entry)) {
        const merged: SyncLogRow = { ...mergeInto(head, entry), id: head.id };
        this.history = [merged, ...rest];
        await db.syncLog.put(merged);
      } else {
        const row: SyncLogRow = { ...entry };
        this.history = [row, ...this.history];
        row.id = await db.syncLog.add(row);
      }
      this.history = this.history.filter((e) => e.completedAt >= cutoff).slice(0, HISTORY_MAX);
      await db.syncLog.where('completedAt').below(cutoff).delete();
      const extra = (await db.syncLog.count()) - HISTORY_MAX;
      if (extra > 0) await db.syncLog.orderBy('completedAt').limit(extra).delete();
    } catch {
      // The history is informational; a failed write doesn't fail the sync.
    }
  }

  /** The name to show for a device id: its name, "" for this device or none. */
  deviceLabel(deviceId: string | null | undefined): string {
    if (!deviceId || deviceId === this.deviceId) return '';
    return this.devices.find((d) => d.id === deviceId)?.name ?? (deviceId === 'unknown' ? 'an older app' : 'another device');
  }

  /** Renames this device; the server hears it on the next sync, which runs now. */
  async renameDevice(name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    await setSyncMeta({ deviceName: trimmed });
    this.deviceName = trimmed;
    if (this.status !== 'local') await this.syncNow().catch(() => {});
  }

  /** Removes another device from the server's list (functions/api/devices.ts). */
  async forgetDevice(id: string): Promise<void> {
    const res = await callApi(`${DEVICES_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.devices = ((await res.json()) as { devices: DeviceInfo[] }).devices;
  }

  /**
   * Check sync: a sync that sends everything and asks the server how many
   * records it has, then compares with this device (`lastCheck`).
   */
  async checkSync(): Promise<void> {
    if (this.inFlight) await this.inFlight.catch(() => {});
    this.checkRequested = true;
    await this.syncNow();
  }

  /**
   * Full resync: sends everything and receives everything again from the
   * start, as a repair when Check sync finds a difference. Nothing local is
   * deleted first, so a record only this device has goes up, not away.
   */
  async fullResync(): Promise<void> {
    if (this.inFlight) await this.inFlight.catch(() => {});
    await setSyncMeta({ cursor: 0, fullSendRequestedAt: Date.now() });
    this.checkRequested = true;
    await this.syncNow();
  }

  /** Sends what's waiting, then signs out through Cloudflare Access (every device). Data stays here. */
  async signOut(): Promise<void> {
    if (this.status !== 'local') await this.syncNow().catch(() => {});
    await setSyncMeta({ signedOutAt: Date.now() });
    window.location.assign(LOGOUT_URL);
  }

  /** Before erasing: one more sync, then what would be lost and what would be deleted. */
  async prepareErase(): Promise<{ waiting: number; synced: boolean; counts: Awaited<ReturnType<typeof countLocalRecords>> }> {
    let synced = this.status !== 'local';
    if (synced) await this.syncNow().catch(() => (synced = false));
    await this.refreshWaiting();
    return { waiting: this.waiting, synced, counts: await countLocalRecords() };
  }

  /** Removes this device from the list, deletes everything stored here, and signs out (every device). */
  async eraseAndSignOut(): Promise<void> {
    if (this.deviceId && this.status !== 'local') await this.forgetDevice(this.deviceId).catch(() => {});
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.history = [];
    await eraseLocalData();
    window.location.assign(LOGOUT_URL);
  }

  /** One page of the shared activity log, newest first; `before` continues from an earlier page. */
  async loadActivity(before?: number): Promise<{ events: ActivityEvent[]; more: boolean }> {
    const query = new URLSearchParams({ limit: '50', ...(before ? { before: String(before) } : {}) });
    const res = await callApi(`${ACTIVITY_ENDPOINT}?${query}`);
    const body = (await res.json()) as { events: ActivityEvent[]; devices: DeviceInfo[]; more: boolean };
    this.devices = body.devices;
    return { events: body.events, more: body.more };
  }

  /** Recounts `waiting`; cheap enough to run after every local write at this app's scale. */
  /**
   * The newest nightly server backup (functions/api/backup-status.ts), for the
   * "Your data" card. Undefined until asked or when the server can't be reached.
   */
  backup = $state<{ configured: boolean; at: number | null } | undefined>(undefined);

  async loadBackupStatus(): Promise<void> {
    if (this.status === 'local') return;
    try {
      const res = await callApi('/api/backup-status');
      const body = (await res.json()) as { configured: boolean; latest?: { uploaded: number } };
      this.backup = { configured: body.configured, at: body.latest?.uploaded ?? null };
    } catch {
      // Offline, signed out or an older server: the card leaves the line out.
      this.backup = undefined;
    }
  }

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
    this.signedOut = !!meta.signedOutAt;
    const device = await getDevice();
    this.deviceId = device.id;
    this.deviceName = device.name;
    this.history = await loadHistory().catch(() => []);

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
        // Once after a burst of edits (an import, typing quickly), not once per edit.
        clearTimeout(this.waitingTimer);
        this.waitingTimer = setTimeout(() => void this.refreshWaiting(), 400);
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
    const run = this.doSync().catch(async (err) => {
      // Away too long (3.70): keep what this device hasn't sent, reload the rest, and sync again once.
      if (!(err instanceof StaleDeviceError)) throw err;
      const kept = await keepUnsyncedAndReset();
      await this.pushHistory({
        completedAt: Date.now(),
        outcome: 'success',
        summary: `Reloaded from the server: this device was away longer than deletes are kept${kept ? ` (kept ${kept} change${kept === 1 ? '' : 's'} not yet sent)` : ''}`,
        rejectedCount: 0,
      });
      await this.doSync();
    });
    this.inFlight = run.finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /**
   * One request to the sync endpoint. An expired Access session comes back as
   * a 401 (thanks to X-Requested-With) or, as a fallback, an opaque redirect
   * with `redirect: 'manual'`, instead of the browser trying (and failing,
   * cross-origin) to follow it; our own Function never returns 401 (it uses
   * 403). 404/405: no sync endpoint at all (the Vite dev server).
   */
  private async post(body: object): Promise<SyncResponseBody> {
    const response = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    if (response.type === 'opaqueredirect' || response.status === 401) throw new UnauthenticatedError();
    if (response.status === 404 || response.status === 405) throw new NoBackendError();
    if (response.status === 409) {
      const err = (await response.json().catch(() => ({}))) as { stale?: boolean };
      if (err.stale) throw new StaleDeviceError();
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
    return (await response.json()) as SyncResponseBody;
  }

  private async doSync(): Promise<void> {
    const wasLocalOnly = this.status === 'local';
    const startedAt = Date.now();
    this.lastAttemptAt = startedAt;
    this.status = 'syncing';
    this.lastError = undefined;
    const check = this.checkRequested;
    this.checkRequested = false;
    try {
      const meta = await getSyncMeta();
      // Usually only what changed since the last good sync; everything on the
      // first sync, after an import or Full resync, and once a day.
      const full =
        check ||
        meta.sentThrough == null ||
        meta.lastFullSendAt == null ||
        startedAt - meta.lastFullSendAt >= FULL_SEND_EVERY_MS ||
        (meta.fullSendRequestedAt ?? 0) > meta.lastFullSendAt;
      const [records, tombstones, device] = await Promise.all([
        full ? getAllSyncableRecords() : getChangedSyncableRecords(meta.sentThrough!, meta.retry),
        getPendingTombstones(),
        getDevice(),
      ]);

      // In parts of at most CHUNK_RECORDS records, and pulling until the server
      // has no more, so no single request grows with the data (3.69).
      const parts = splitForSending(records);
      const from = (id: string | null | undefined) => this.deviceLabel(id);
      const received: RemoteSyncChanges = { fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], taskProjects: [], tasks: [], taskCompletions: [], settings: null };
      const rejected: SyncResponseBody['rejected'] = [];
      const applied: AppliedRecord[] = [];
      const appliedCounts: AppliedCounts = {};
      const overwritten: string[] = [];
      let counts: SyncResponseBody['counts'];
      let cursor = meta.cursor;
      // Names as they are before this sync, for edits another device replaced.
      const namesBefore = meta.sentThrough == null ? null : await localNames().catch(() => null);
      for (let i = 0; i < MAX_REQUESTS_PER_SYNC; i++) {
        const part = parts[i];
        const body = await this.post({
          cursor,
          changes: part ?? splitForSending({ ...records, ...emptyLists(), settings: null })[0],
          tombstones: i === 0 ? tombstones.map(({ recordType, uuid, deletedAt }) => ({ recordType, uuid, deletedAt })) : [],
          device: { id: device.id, name: device.name, appVersion: __APP_VERSION__ },
          ...(check ? { check: true } : {}),
        });
        if (body.devices) this.devices = body.devices;
        if (namesBefore) overwritten.push(...findOverwritten(records, meta.sentThrough, body.changes, from, namesBefore));
        await applyRemoteChanges(body.changes);
        if (i === 0) await prunePendingTombstones(tombstones.map((t) => t.id).filter((id): id is number => id != null));
        mergeChanges(received, body.changes);
        rejected.push(...(body.rejected ?? []));
        applied.push(...(body.applied ?? []));
        for (const [k, v] of Object.entries(body.appliedCounts ?? {})) appliedCounts[k as keyof AppliedCounts] = (appliedCounts[k as keyof AppliedCounts] ?? 0) + (v ?? 0);
        counts = body.counts ?? counts;
        // What's applied here stays applied: a failure later in the sync starts from this point.
        cursor = body.cursor;
        await setSyncMeta({ cursor });
        if (i >= parts.length - 1 && !body.more) break;
      }

      // Refused records go again next time, so they keep showing as not synced
      // until they're fixed or deleted.
      const retry: SyncRetryKey[] = rejected
        .filter((r) => RETRY_TYPES.has(r.recordType) && r.uuid)
        .map((r) => ({ recordType: r.recordType as SyncRetryKey['recordType'], uuid: r.uuid }));
      await setSyncMeta({
        cursor,
        lastSyncedAt: Date.now(),
        sentThrough: startedAt,
        retry,
        signedOutAt: undefined,
        ...(full ? { lastFullSendAt: startedAt } : {}),
      });
      this.signedOut = false;

      this.lastSyncedAt = Date.now();
      this.rejected = rejected;
      this.rejectedDetails = this.rejected.length
        ? await describeRejectedLocally(this.rejected).catch(() =>
            this.rejected.map((r) => `${r.recordType} ${r.uuid}: ${r.reason}`),
          )
        : [];
      this.status = 'idle';

      if (check) {
        const here = await countLocalRecords();
        const server = counts;
        const rows = (Object.keys(CHECK_LABELS) as SyncRecordType[]).map((k) => ({
          label: CHECK_LABELS[k],
          here: here[k],
          server: server?.[k] ?? 0,
        }));
        this.lastCheck = {
          at: Date.now(),
          rows,
          matches: !!server && rows.every((r) => r.here === r.server),
          rejected: this.rejected.length,
          ...(server ? {} : { unsupported: true }),
        };
      }

      const names = await localNames().catch(() => null);
      const receivedLines = names ? describeReceived(received, from, names) : [];
      const sent = names ? describeSent(applied.slice(0, HISTORY_DETAILS_LIMIT), records, tombstones, names) : [];
      const sentTotal = Object.values(appliedCounts).reduce((a, b) => a + (b ?? 0), 0);

      await this.pushHistory({
        completedAt: this.lastSyncedAt,
        outcome: 'success',
        summary: summarizeSync(appliedCounts, {
          fasts: received.fasts.length,
          fieldDefinitions: received.fieldDefinitions.length,
          trackableDefinitions: received.trackableDefinitions.length,
          trackableEntries: received.trackableEntries.length,
          taskProjects: received.taskProjects?.length ?? 0,
          tasks: received.tasks?.length ?? 0,
          taskCompletions: received.taskCompletions?.length ?? 0,
          settings: !!received.settings,
        }),
        rejectedCount: this.rejected.length,
        rejectedDetails: this.rejectedDetails.length ? this.rejectedDetails.slice(0, REJECTED_DETAILS_LIMIT) : undefined,
        details: receivedLines.slice(0, HISTORY_DETAILS_LIMIT),
        moreDetailsCount: Math.max(0, receivedLines.length - HISTORY_DETAILS_LIMIT),
        sentDetails: sent.slice(0, HISTORY_DETAILS_LIMIT),
        moreSentCount: Math.max(0, sentTotal - Math.min(sent.length, HISTORY_DETAILS_LIMIT)),
        durationMs: Date.now() - startedAt,
        ...(full ? { full: true } : {}),
        ...(overwritten.length ? { overwritten } : {}),
      });
      void this.refreshWaiting();

      const listeners = this.syncedListeners;
      this.syncedListeners = [];
      for (const listener of listeners) listener();
    } catch (err) {
      // Handled by syncNow: reload and sync again, not a failure.
      if (err instanceof StaleDeviceError) throw err;
      if (err instanceof NoBackendError) {
        // Not a failure: this install simply has no sync server (local-only
        // use, `npm run dev`). Record it once, not on every edit.
        this.status = 'local';
        if (!wasLocalOnly) {
          await this.pushHistory({ completedAt: Date.now(), outcome: 'local', summary: err.message, rejectedCount: 0 });
        }
        throw err;
      }
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const isUnauthenticated = err instanceof UnauthenticatedError;
      this.status = isOffline ? 'offline' : isUnauthenticated ? 'unauthenticated' : 'error';
      this.lastError =
        isUnauthenticated && this.signedOut ? 'Signed out -- log in again to sync.' : err instanceof Error ? err.message : String(err);

      await this.pushHistory({
        completedAt: Date.now(),
        outcome: isOffline ? 'offline' : 'error',
        summary: isOffline ? 'Offline -- sync skipped' : isUnauthenticated ? (this.signedOut ? 'Signed out' : 'Login expired') : 'Sync failed',
        rejectedCount: 0,
        error: this.lastError,
      });
      void this.refreshWaiting();

      throw err;
    }
  }
}

export const syncStore = new SyncStore();
