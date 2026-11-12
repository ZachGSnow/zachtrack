import type {
  FastRecord,
  FieldDefinition,
  RemoteSyncChanges,
  SettingsRecord,
  SyncRecordType,
  SyncTombstone,
  Task,
  TaskCompletion,
  TaskProject,
  TrackableDefinition,
  TrackableEntry,
} from '../db';
import { formatClockTime, formatDateTime } from './time';

/**
 * The lines the sync history shows for what a sync sent, received and lost to
 * a newer edit elsewhere (ARCHITECTURE.md 3.10). Pure: the sync store looks up
 * the names on this device and passes them in.
 */

/** A record the server stored from this device. */
export interface AppliedRecord {
  recordType: SyncRecordType | 'settings';
  uuid: string;
  deleted?: boolean;
}

/** Names on this device, for history lines. */
export interface LocalNames {
  trackableById: Map<string, TrackableDefinition>;
  fieldById: Map<string, FieldDefinition>;
  taskNameById: Map<string, string>;
}

/** Records a sync sent. */
export interface SentRecords {
  fasts: FastRecord[];
  fieldDefinitions: FieldDefinition[];
  trackableDefinitions: TrackableDefinition[];
  trackableEntries: TrackableEntry[];
  taskProjects: TaskProject[];
  tasks: Task[];
  taskCompletions: TaskCompletion[];
  settings?: SettingsRecord | null;
}

/** Names the device a change came from, or '' for this one or an unknown one. */
export type DeviceName = (deviceId: string | null | undefined) => string;

export function formatFieldValue(field: FieldDefinition | undefined, value: number | boolean): string {
  if (!field) return String(value);
  if (field.kind === 'boolean') return value ? 'Yes' : 'No';
  if (field.kind === 'rating') return `${value}/${field.ratingMax ?? 5}`;
  return field.unit ? `${value} ${field.unit}` : `${value}`;
}

export function describeFast(fast: FastRecord): string {
  if (fast.endTime) return `Fast -- ${formatDateTime(fast.startTime)} to ${formatClockTime(fast.endTime)}`;
  return `Fast started -- ${formatDateTime(fast.startTime)}`;
}

export function describeEntry(entry: TrackableEntry, names: Pick<LocalNames, 'trackableById' | 'fieldById'>): string {
  const trackableName = names.trackableById.get(entry.trackableId)?.name ?? 'Unknown trackable';
  const values = Object.entries(entry.values ?? {}).map(([fieldId, value]) => {
    const field = names.fieldById.get(fieldId);
    return `${field?.name ?? fieldId}: ${formatFieldValue(field, value)}`;
  });
  const suffix = values.length ? ` (${values.join(', ')})` : '';
  return `${trackableName}${suffix} -- ${formatDateTime(entry.timestamp)}`;
}

/** "Task -- Change oil, due Nov 30": what a task line in the sync history says. */
export function describeTask(task: Pick<Task, 'name' | 'dueOn' | 'completedAt'>): string {
  const due = task.dueOn ? `, due ${task.dueOn}` : '';
  return `${task.completedAt ? 'Task done' : 'Task'} -- ${task.name || 'Untitled'}${due}`;
}

/**
 * One line per record received from the server, for the history's detail view.
 * Pass names read after `applyRemoteChanges`, so new trackables and tasks are named.
 */
export function describeReceived(changes: RemoteSyncChanges, from: DeviceName, names: LocalNames): string[] {
  const details: string[] = [];
  const by = (deviceId: string | null | undefined) => {
    const name = from(deviceId);
    return name ? ` (${name})` : '';
  };
  for (const fast of changes.fasts) {
    details.push((fast.deletedAt ? `Fast deleted -- started ${formatDateTime(fast.startTime)}` : describeFast(fast)) + by(fast.updatedBy));
  }
  for (const field of changes.fieldDefinitions) {
    details.push((field.deletedAt ? `Field deleted -- ${field.name}` : `Field -- ${field.name}`) + by(field.updatedBy));
  }
  for (const trackable of changes.trackableDefinitions) {
    details.push((trackable.deletedAt ? `Trackable deleted -- ${trackable.name}` : `Trackable -- ${trackable.name}`) + by(trackable.updatedBy));
  }
  for (const entry of changes.trackableEntries) {
    if (entry.deletedAt) {
      details.push(`Entry deleted -- ${names.trackableById.get(entry.trackableId)?.name ?? 'Unknown trackable'}${by(entry.updatedBy)}`);
      continue;
    }
    details.push(describeEntry(entry, names) + by(entry.updatedBy));
  }
  for (const project of changes.taskProjects ?? []) {
    details.push((project.deletedAt ? `Project deleted -- ${project.name}` : `Project -- ${project.name}`) + by(project.updatedBy));
  }
  for (const task of changes.tasks ?? []) {
    details.push((task.deletedAt ? 'Task deleted' : describeTask(task)) + by(task.updatedBy));
  }
  for (const c of changes.taskCompletions ?? []) {
    const name = names.taskNameById.get(c.taskId) ?? 'a task';
    details.push((c.deletedAt ? `Completion undone -- ${name}` : `Completed -- ${name}`) + by(c.updatedBy));
  }
  if (changes.settings) details.push(`Settings updated${by(changes.settings.updatedBy)}`);
  return details;
}

/**
 * Edits made on this device (changed since the last good sync) that a newer
 * edit from another device replaced: the server kept the other one and sent
 * it back. One line each, e.g. "Your edit to Water (12 oz) was replaced by
 * Laptop's newer one". `sent` is what this device sent, so it still has this
 * device's edit.
 */
export function findOverwritten(
  sent: SentRecords,
  editedSince: number | undefined,
  changes: RemoteSyncChanges,
  from: DeviceName,
  names: Pick<LocalNames, 'trackableById' | 'fieldById'>,
): string[] {
  if (editedSince == null) return [];
  const edited = <T extends { updatedAt: number }>(list: T[]) => list.filter((r) => r.updatedAt >= editedSince);
  const lines: string[] = [];
  const newer = (remote: { updatedAt: number; deletedAt?: number | null; updatedBy?: string | null }, local: { updatedAt: number }, what: string) => {
    if (Math.max(remote.updatedAt, remote.deletedAt ?? 0) <= local.updatedAt) return;
    const who = from(remote.updatedBy) || 'another device';
    lines.push(remote.deletedAt ? `Your edit to ${what} was replaced: ${who} deleted it` : `Your edit to ${what} was replaced by ${who}'s newer one`);
  };
  const fasts = new Map(edited(sent.fasts).map((f) => [f.uuid, f] as const));
  for (const r of changes.fasts) {
    const local = fasts.get(r.uuid);
    if (local) newer(r, local, `the fast from ${formatDateTime(local.startTime)}`);
  }
  const fields = new Map(edited(sent.fieldDefinitions).map((f) => [f.id, f] as const));
  for (const r of changes.fieldDefinitions) {
    const local = fields.get(r.id);
    if (local) newer(r, local, `the field ${local.name}`);
  }
  const trackables = new Map(edited(sent.trackableDefinitions).map((t) => [t.id, t] as const));
  for (const r of changes.trackableDefinitions) {
    const local = trackables.get(r.id);
    if (local) newer(r, local, local.name);
  }
  const entries = new Map(edited(sent.trackableEntries).map((e) => [e.id, e] as const));
  for (const r of changes.trackableEntries) {
    const local = entries.get(r.id);
    if (local) newer(r, local, `an entry: ${describeEntry(local, names)}`);
  }
  const projects = new Map(edited(sent.taskProjects).map((p) => [p.id, p] as const));
  for (const r of changes.taskProjects ?? []) {
    const local = projects.get(r.id);
    if (local) newer(r, local, `the project ${local.name}`);
  }
  const tasks = new Map(edited(sent.tasks).map((t) => [t.id, t] as const));
  for (const r of changes.tasks ?? []) {
    const local = tasks.get(r.id);
    if (local) newer(r, local, `the task ${local.name}`);
  }
  if (sent.settings && sent.settings.updatedAt >= editedSince && changes.settings) newer(changes.settings, sent.settings, 'Settings');
  return lines;
}

const KIND_NAME: Record<AppliedRecord['recordType'], string> = {
  fasts: 'Fast',
  fieldDefinitions: 'Field',
  trackableDefinitions: 'Trackable',
  trackableEntries: 'Entry',
  taskProjects: 'Project',
  tasks: 'Task',
  taskCompletions: 'Completion',
  settings: 'Settings',
};

/** One line per record the server stored from this device (`applied`), named from what was sent. */
export function describeSent(applied: AppliedRecord[], sent: SentRecords, tombstones: SyncTombstone[], names: LocalNames): string[] {
  const deletedLabel = new Map<string, string | undefined>(tombstones.map((t) => [`${t.recordType}:${t.uuid}`, t.label]));
  const byKey = {
    fasts: new Map(sent.fasts.map((f) => [f.uuid, f] as const)),
    fieldDefinitions: new Map(sent.fieldDefinitions.map((f) => [f.id, f] as const)),
    trackableDefinitions: new Map(sent.trackableDefinitions.map((t) => [t.id, t] as const)),
    trackableEntries: new Map(sent.trackableEntries.map((e) => [e.id, e] as const)),
    taskProjects: new Map(sent.taskProjects.map((p) => [p.id, p] as const)),
    tasks: new Map(sent.tasks.map((t) => [t.id, t] as const)),
    taskCompletions: new Map(sent.taskCompletions.map((c) => [c.id, c] as const)),
  };
  return applied.map((a) => {
    if (a.deleted) {
      const label = deletedLabel.get(`${a.recordType}:${a.uuid}`);
      return `${KIND_NAME[a.recordType]} deleted${label ? ` -- ${label}` : ''}`;
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
      case 'taskProjects':
        return `Project -- ${byKey.taskProjects.get(a.uuid)?.name ?? a.uuid}`;
      case 'tasks': {
        const task = byKey.tasks.get(a.uuid);
        return task ? describeTask(task) : 'Task';
      }
      case 'taskCompletions': {
        const c = byKey.taskCompletions.get(a.uuid);
        return `Completed -- ${(c && names.taskNameById.get(c.taskId)) ?? 'a task'}`;
      }
      case 'settings':
        return 'Settings updated';
    }
  });
}
