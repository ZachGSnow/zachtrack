import { getAllSyncableRecords } from './db';
import { buildExport, exportFileName, type ExportFile } from './dataFile';
import { loadPrefs, savePrefs } from './utils/prefs';

// The full JSON export as a download, shared by Settings > Your data and the
// "Your data" card on Today, and the per-device note of when it last happened
// (ARCHITECTURE.md 3.52).

const LAST_EXPORT_KEY = 'last-export';

/** When this device last exported a backup file, or undefined. */
export function lastExportAt(): number | undefined {
  const at = Number(loadPrefs<{ at: unknown }>(LAST_EXPORT_KEY, { at: 0 }).at);
  return at > 0 ? at : undefined;
}

/** Hands text to the browser as a file download. */
export function download(text: string, name: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads everything on this device as a restorable JSON file, and remembers when. */
export async function downloadBackupFile(now: Date = new Date()): Promise<ExportFile> {
  const file = buildExport(await getAllSyncableRecords(), now);
  download(JSON.stringify(file, null, 2), exportFileName(now), 'application/json');
  savePrefs(LAST_EXPORT_KEY, { at: now.getTime() });
  return file;
}
