import { describe, expect, it } from 'vitest';
import { assessDataSafety } from '../src/lib/utils/dataSafety';

const NOW = Date.UTC(2026, 10, 8, 12);
const H = 3600_000;
const D = 24 * H;

describe('data safety', () => {
  it('is all right when synced, backed up last night and exported this month', () => {
    const r = assessDataSafety({ syncStatus: 'idle', lastSyncedAt: NOW - 5 * 60_000, waiting: 0, backupConfigured: true, backupAt: NOW - 8 * H, lastExportAt: NOW - 3 * D, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.text)).toEqual(['Synced 5 minutes ago', 'Server backup 8 hours ago', 'Exported here 3 days ago']);
  });

  it('warns about stale sync, a late backup and an old export', () => {
    const r = assessDataSafety({ syncStatus: 'idle', lastSyncedAt: NOW - 4 * D, waiting: 2, backupConfigured: true, backupAt: NOW - 2 * D, lastExportAt: NOW - 40 * D, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([
      { text: 'Synced 4 days ago, 2 changes waiting', tone: 'warn' },
      { text: 'Server backup 2 days ago', tone: 'warn' },
      { text: 'Exported here 40 days ago', tone: 'warn' },
    ]);
  });

  it('says so when signed out or in error, and leaves the backup out when the server can\'t see it', () => {
    expect(assessDataSafety({ syncStatus: 'unauthenticated', waiting: 0, now: NOW }).lines[0]).toEqual({ text: 'Signed out: log in again to resume syncing', tone: 'warn' });
    expect(assessDataSafety({ syncStatus: 'error', waiting: 0, now: NOW }).lines[0].tone).toBe('warn');
    const noBucket = assessDataSafety({ syncStatus: 'idle', lastSyncedAt: NOW, waiting: 0, backupConfigured: false, lastExportAt: NOW, now: NOW });
    expect(noBucket.lines.map((l) => l.text)).toEqual(['Synced just now', 'Exported here just now']);
    expect(assessDataSafety({ syncStatus: 'idle', lastSyncedAt: NOW, waiting: 0, backupConfigured: true, backupAt: null, now: NOW }).lines[1]).toEqual({ text: 'No server backup yet', tone: 'warn' });
  });

  it('on a local-only install, an export is the only backup', () => {
    const never = assessDataSafety({ syncStatus: 'local', waiting: 0, now: NOW });
    expect(never.ok).toBe(false);
    expect(never.lines.map((l) => l.text)).toEqual(['Local only: this device holds the only copy', 'Never exported from this device']);
    expect(assessDataSafety({ syncStatus: 'local', waiting: 0, lastExportAt: NOW - D, now: NOW }).ok).toBe(true);
  });
});
