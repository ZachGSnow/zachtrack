// D1 rows to app records, for what the server sends (functions/api/sync.ts)
// and what the reminder Worker reads (server/reminders.ts). JSON columns are
// parsed, NULL becomes absent.

import type {
  FastRecord,
  FieldDefinition,
  TrackableDefinition,
  TrackableEntry,
  SettingsRecord,

  Task,
  TaskCompletion,
  TaskProject,
} from '../src/lib/db';

/** A record as it goes over the wire: with its delete time and the device that last changed it. */
export type WireRow<T> = T & { deletedAt?: number; updatedBy?: string };

export function mapFastRow(row: Record<string, unknown>): WireRow<FastRecord> {
  return {
    uuid: row.uuid as string,
    startTime: row.startTime as number,
    startDay: row.startDay as number,
    endTime: (row.endTime as number) ?? undefined,
    method: row.method as FastRecord['method'],
    presetId: (row.presetId as string) ?? undefined,
    presetLabel: (row.presetLabel as string) ?? undefined,
    targetHours: (row.targetHours as number) ?? undefined,
    moodRating: (row.moodRating as number) ?? undefined,
    energyRating: (row.energyRating as number) ?? undefined,
    hungerRating: (row.hungerRating as number) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    note: (row.note as string) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapFieldRow(row: Record<string, unknown>): WireRow<FieldDefinition> {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as FieldDefinition['kind'],
    unit: (row.unit as string) ?? undefined,
    ratingMin: (row.ratingMin as number) ?? undefined,
    ratingMax: (row.ratingMax as number) ?? undefined,
    aggregation: (row.aggregation as FieldDefinition['aggregation']) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapTrackableRow(row: Record<string, unknown>): WireRow<TrackableDefinition> {
  return {
    id: row.id as string,
    name: row.name as string,
    icon: row.icon as string,
    color: row.color as string,
    fieldIds: row.fieldIds ? JSON.parse(row.fieldIds as string) : [],
    displayMode: (row.displayMode as TrackableDefinition['displayMode']) ?? undefined,
    goalType: (row.goalType as TrackableDefinition['goalType']) ?? undefined,
    goalValue: (row.goalValue as number) ?? undefined,
    pinned: row.pinned == null ? undefined : Boolean(row.pinned),
    archived: row.archived == null ? undefined : Boolean(row.archived),
    sortOrder: (row.sortOrder as number) ?? undefined,
    scheduleDays: row.scheduleDays ? JSON.parse(row.scheduleDays as string) : undefined,
    skipDays: row.skipDays ? JSON.parse(row.skipDays as string) : undefined,
    pausedUntil: (row.pausedUntil as number) ?? undefined,
    dateKind: (row.dateKind as TrackableDefinition['dateKind']) ?? undefined,
    dateLeadDays: (row.dateLeadDays as number) ?? undefined,
    insightsHidden: row.insightsHidden == null ? undefined : Boolean(row.insightsHidden),
    scheduleHistory: row.scheduleHistory ? JSON.parse(row.scheduleHistory as string) : undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapEntryRow(row: Record<string, unknown>): WireRow<TrackableEntry> {
  return {
    id: row.id as string,
    trackableId: row.trackableId as string,
    timestamp: row.timestamp as number,
    note: (row.note as string) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    values: row.fieldValues ? JSON.parse(row.fieldValues as string) : undefined,
    dateRepeat: row.dateRepeat ? JSON.parse(row.dateRepeat as string) : undefined,
    details: (row.details as string) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapTaskProjectRow(row: Record<string, unknown>): WireRow<TaskProject> {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    icon: (row.icon as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    sections: row.sections ? JSON.parse(row.sections as string) : [],
    archived: row.archived == null ? undefined : Boolean(row.archived),
    sortOrder: (row.sortOrder as number) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapTaskRow(row: Record<string, unknown>): WireRow<Task> {
  return {
    id: row.id as string,
    name: row.name as string,
    projectId: (row.projectId as string) ?? undefined,
    sectionId: (row.sectionId as string) ?? undefined,
    parentId: (row.parentId as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    dueOn: (row.dueOn as string) ?? undefined,
    dueTime: (row.dueTime as string) ?? undefined,
    repeat: row.repeat ? JSON.parse(row.repeat as string) : undefined,
    completedAt: (row.completedAt as number) ?? undefined,
    sortOrder: row.sortOrder as number,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapTaskCompletionRow(row: Record<string, unknown>): WireRow<TaskCompletion> {
  return {
    id: row.id as string,
    taskId: row.taskId as string,
    completedAt: row.completedAt as number,
    dueOn: (row.dueOn as string) ?? undefined,
    nextDueOn: (row.nextDueOn as string) ?? undefined,
    subtaskIds: row.subtaskIds ? JSON.parse(row.subtaskIds as string) : undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}

export function mapSettingsRow(row: Record<string, unknown>): WireRow<SettingsRecord> {
  return {
    id: 'app-settings',
    defaultPresetId: row.defaultPresetId as string,
    notificationsEnabled: Boolean(row.notificationsEnabled),
    heightInches: (row.heightInches as number) ?? undefined,
    goalWeightLb: (row.goalWeightLb as number) ?? undefined,
    weightFieldId: (row.weightFieldId as string) ?? undefined,
    waistFieldId: (row.waistFieldId as string) ?? undefined,
    neckFieldId: (row.neckFieldId as string) ?? undefined,
    hipFieldId: (row.hipFieldId as string) ?? undefined,
    bodyFatSex: (row.bodyFatSex as SettingsRecord['bodyFatSex']) ?? undefined,
    fastScheduleTime: (row.fastScheduleTime as string) ?? undefined,
    customFastPresets: row.customFastPresets ? JSON.parse(row.customFastPresets as string) : undefined,
    fastWeekPlan: row.fastWeekPlan ? JSON.parse(row.fastWeekPlan as string) : undefined,
    mutedInsights: row.mutedInsights ? JSON.parse(row.mutedInsights as string) : undefined,
    updatedAt: row.updatedAt as number,
    deletedAt: (row.deletedAt as number) ?? undefined,
    updatedBy: (row.updatedBy as string) ?? undefined,
  };
}
