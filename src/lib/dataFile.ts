// JSON export / import of everything stored on this device.
//
// Export writes every syncable record as plain JSON (fasts without Dexie's
// local `id`). Import never deletes anything: it validates the file with the
// same checks the sync endpoint uses, then merges record by record with the
// rule sync uses (keep the newer `updatedAt`), so importing an old file on top
// of newer data changes nothing. The plan is computed first and shown to the
// user; only a confirmed plan is written. See ARCHITECTURE.md 3.13.

import type { FastRecord, FieldDefinition, SettingsRecord, TrackableDefinition, TrackableEntry } from './db';
import { invalidReason, recordKey, type RecordKind } from './validate';

export const EXPORT_FORMAT = 'zachtrack-export';
export const EXPORT_VERSION = 1;

export interface ExportData {
  fasts: Omit<FastRecord, 'id'>[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  settings: SettingsRecord | null;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  data: ExportData;
}

export interface LocalSnapshot {
  fasts: FastRecord[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  settings: SettingsRecord | null;
}

export function buildExport(local: LocalSnapshot, now: Date): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    data: {
      fasts: local.fasts.map(({ id: _localId, ...fast }) => fast),
      fieldDefinitions: local.fieldDefinitions,
      trackableDefinitions: local.trackableDefinitions,
      trackableEntries: local.trackableEntries,
      settings: local.settings,
    },
  };
}

export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `zachtrack-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export interface SkippedRecord {
  recordType: RecordKind;
  id: string;
  reason: string;
}

export interface ImportPlan {
  exportedAt: string;
  /** Records to write, in the shape `applyRemoteChanges` takes. */
  changes: ExportData;
  added: number;
  updated: number;
  /** Already here with the same or a newer version. */
  unchanged: number;
  skipped: SkippedRecord[];
}

export type ParseResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads an export file and works out what importing it would change. Writes nothing. */
export function planImport(text: string, local: LocalSnapshot): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isObject(parsed) || parsed.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'This is not a ZachTrack export file.' };
  }
  if (parsed.version !== EXPORT_VERSION) {
    return { ok: false, error: `This export is version ${String(parsed.version)}; this app reads version ${EXPORT_VERSION}.` };
  }
  if (!isObject(parsed.data)) return { ok: false, error: 'The export file has no data section.' };
  const data = parsed.data;

  const skipped: SkippedRecord[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  function valid<T>(kind: RecordKind, list: unknown): T[] {
    if (list == null) return [];
    if (!Array.isArray(list)) {
      skipped.push({ recordType: kind, id: '', reason: `${kind} is not a list` });
      return [];
    }
    return list.filter((record): record is T => {
      const reason = invalidReason(kind, record);
      if (reason) skipped.push({ recordType: kind, id: recordKey(record), reason });
      return reason === null;
    });
  }

  /** Keeps a record only if it is new here or newer than the local copy. */
  function newer<T extends { updatedAt: number }>(incoming: T, existing: T | undefined): boolean {
    if (!existing) {
      added++;
      return true;
    }
    if (incoming.updatedAt > existing.updatedAt) {
      updated++;
      return true;
    }
    unchanged++;
    return false;
  }

  const byId = <T, K>(list: T[], key: (t: T) => K) => new Map(list.map((t) => [key(t), t] as const));

  const localFields = byId(local.fieldDefinitions, (f) => f.id);
  const fieldDefinitions = valid<FieldDefinition>('fieldDefinitions', data.fieldDefinitions).filter((f) =>
    newer(f, localFields.get(f.id)),
  );

  const localTrackables = byId(local.trackableDefinitions, (t) => t.id);
  const trackableDefinitions = valid<TrackableDefinition>('trackableDefinitions', data.trackableDefinitions).filter((t) =>
    newer(t, localTrackables.get(t.id)),
  );

  // An entry whose trackable is neither here nor in the file would be invisible.
  const knownTrackables = new Set([...localTrackables.keys(), ...trackableDefinitions.map((t) => t.id)]);
  const localEntries = byId(local.trackableEntries, (e) => e.id);
  const trackableEntries = valid<TrackableEntry>('trackableEntries', data.trackableEntries).filter((e) => {
    if (!knownTrackables.has(e.trackableId)) {
      skipped.push({ recordType: 'trackableEntries', id: e.id, reason: 'its trackable is not on this device or in the file' });
      return false;
    }
    return newer(e, localEntries.get(e.id));
  });

  // One fast per start day, same rule as the server: a different fast that
  // already owns the day here wins, and the imported one is reported.
  const localFasts = byId(local.fasts, (f) => f.uuid);
  const dayOwner = new Map(local.fasts.map((f) => [f.startDay, f.uuid] as const));
  const fasts = valid<Omit<FastRecord, 'id'>>('fasts', data.fasts)
    .map(({ id: _id, ...fast }: Omit<FastRecord, 'id'> & { id?: unknown }) => fast)
    .filter((f) => {
      const owner = dayOwner.get(f.startDay);
      if (owner && owner !== f.uuid) {
        skipped.push({ recordType: 'fasts', id: f.uuid, reason: 'another fast already starts on that day' });
        return false;
      }
      dayOwner.set(f.startDay, f.uuid);
      return newer(f as FastRecord, localFasts.get(f.uuid));
    });

  let settings: SettingsRecord | null = null;
  if (data.settings != null) {
    const [candidate] = valid<SettingsRecord>('settings', [data.settings]);
    if (candidate && newer(candidate, local.settings ?? undefined)) settings = candidate;
  }

  return {
    ok: true,
    plan: {
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      changes: { fasts, fieldDefinitions, trackableDefinitions, trackableEntries, settings },
      added,
      updated,
      unchanged,
      skipped,
    },
  };
}
