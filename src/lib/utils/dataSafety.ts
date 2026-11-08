import { DAY_MS } from './time';

// "Your data" on Today (ARCHITECTURE.md 3.52): is everything safe? The
// research behind v1.18 found that the second biggest reason people leave
// tracking apps is losing their data, so the app says plainly where the data
// is: synced, backed up on the server last night, exported from this device.
// Pure; tests/dataSafety.test.ts.

export type SafetyTone = 'ok' | 'warn';

export interface SafetyLine {
  text: string;
  tone: SafetyTone;
}

export interface SafetyInput {
  /** The sync pill's state (stores/sync.svelte.ts). */
  syncStatus: 'idle' | 'syncing' | 'error' | 'offline' | 'unauthenticated' | 'local';
  lastSyncedAt?: number;
  /** Changes on this device the server doesn't have yet. */
  waiting: number;
  /** The newest nightly backup's upload time; undefined when unknown, null when there is none. */
  backupAt?: number | null;
  /** The server can't see the backup bucket (no binding): leave the line out. */
  backupConfigured?: boolean;
  /** When this device last exported a backup file. */
  lastExportAt?: number;
  now: number;
}

/** Sync older than this, or an export older than EXPORT_DAYS, is worth a warning. */
export const SYNC_STALE_DAYS = 3;
export const EXPORT_DAYS = 30;
/** The nightly backup is late after this long. */
export const BACKUP_STALE_HOURS = 36;

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(ms / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function assessDataSafety(i: SafetyInput): { ok: boolean; lines: SafetyLine[] } {
  const lines: SafetyLine[] = [];
  const local = i.syncStatus === 'local';

  if (local) {
    lines.push({ text: 'Local only: this device holds the only copy', tone: i.lastExportAt ? 'ok' : 'warn' });
  } else if (i.syncStatus === 'unauthenticated') {
    lines.push({ text: 'Signed out: log in again to resume syncing', tone: 'warn' });
  } else if (i.syncStatus === 'error') {
    lines.push({ text: 'Sync error: open Sync to see what went wrong', tone: 'warn' });
  } else {
    const stale = i.lastSyncedAt == null || i.now - i.lastSyncedAt > SYNC_STALE_DAYS * DAY_MS;
    const when = i.lastSyncedAt == null ? 'not yet' : ago(i.now - i.lastSyncedAt);
    const waiting = i.waiting > 0 ? `, ${i.waiting} ${i.waiting === 1 ? 'change' : 'changes'} waiting` : '';
    lines.push({ text: `Synced ${when}${waiting}`, tone: stale ? 'warn' : 'ok' });
  }

  if (!local && i.backupConfigured) {
    if (i.backupAt === null) lines.push({ text: 'No server backup yet', tone: 'warn' });
    else if (i.backupAt != null) {
      const late = i.now - i.backupAt > BACKUP_STALE_HOURS * 3600_000;
      lines.push({ text: `Server backup ${ago(i.now - i.backupAt)}`, tone: late ? 'warn' : 'ok' });
    }
  }

  if (i.lastExportAt == null) {
    lines.push({ text: 'Never exported from this device', tone: local ? 'warn' : 'ok' });
  } else {
    const old = i.now - i.lastExportAt > EXPORT_DAYS * DAY_MS;
    lines.push({ text: `Exported here ${ago(i.now - i.lastExportAt)}`, tone: old ? 'warn' : 'ok' });
  }

  return { ok: lines.every((l) => l.tone === 'ok'), lines };
}
