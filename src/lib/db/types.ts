// The records the app keeps on this device, and the sync bookkeeping
// (ARCHITECTURE.md section 2). Types, plus the default settings.

import type { CustomFastPreset } from '../data/presets';
import type { SyncHistoryEntry } from '../utils/syncHistory';
import type { BodyFatSex } from '../utils/health';

export interface FastRecord {
  id?: number;
  /** Stable id used for sync, independent of Dexie's local auto-increment `id`. */
  uuid: string;
  /** Epoch milliseconds. */
  startTime: number;
  /** Start-of-day (local midnight) epoch ms for `startTime`. Enforced unique at the app level. */
  startDay: number;
  /** Epoch milliseconds; null/undefined while the fast is still active. */
  endTime?: number;
  method: 'preset' | 'custom';
  presetId?: string;
  presetLabel?: string;
  targetHours?: number;
  moodRating?: number; // 1-5
  energyRating?: number; // 1-5
  hungerRating?: number; // 1-5
  /** Free-form context tags, e.g. "traveled", "stressful", "workout". */
  tags?: string[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type FieldKind = 'number' | 'rating' | 'boolean';

/**
 * How multiple same-day entries for a field should be combined for daily
 * charts/stats. 'sum' for cumulative metrics (e.g. Water, Calories),
 * 'average' for point-in-time readings taken more than once a day (e.g.
 * Blood Pressure), 'last' (default when unset) for "most recent reading
 * wins" (e.g. Weight). Only meaningful for 'number'/'rating' fields.
 */
export type FieldAggregation = 'sum' | 'average' | 'last';

/** A reusable, globally-defined metric (e.g. "Weight", "Pain") attachable to any Trackable. */
export interface FieldDefinition {
  id: string; // uuid
  name: string;
  kind: FieldKind;
  /** Only meaningful for 'number' fields, e.g. "lb", "oz", "kcal". */
  unit?: string;
  /** Only meaningful for 'rating' fields; defaults to 1-5 if unset. */
  ratingMin?: number;
  ratingMax?: number;
  /** Undefined behaves as 'last' (preserves pre-existing behavior). */
  aggregation?: FieldAggregation;
  createdAt: number;
  updatedAt: number;
}

/** dailyTotal: the first field's total per day; perDay: entries per day; perWeek: days logged per week; everyDays: due every N days; avoid: time since is the streak. */
export type TrackableGoalType = 'dailyTotal' | 'perDay' | 'perWeek' | 'everyDays' | 'avoid';

/** How a trackable is summarised; 'occurrences' (or unset) = automatic from its fields. See utils/trackableKinds.ts. */
export type TrackableDisplayMode = 'occurrences' | 'ages' | 'event' | 'measurement' | 'daily' | 'checkin';

/** A user-defined "thing to track" -- an occurrence, optionally carrying values for its attached fields. */
export interface TrackableDefinition {
  id: string; // uuid
  name: string;
  icon: string; // emoji
  color: string; // hex
  /** Ordered list of FieldDefinition ids attached to this trackable. */
  fieldIds: string[];
  /**
   * Which kind it is shown as (utils/trackableKinds.ts). Omitted or
   * 'occurrences' = automatic from its fields. 'ages' is for tracking people
   * by birthdate (entry.timestamp = birthdate, entry.note = name).
   */
  displayMode?: TrackableDisplayMode;
  /** Optional goal (utils/trackableGoals.ts); `goalValue` is its number (amount, times or days). */
  goalType?: TrackableGoalType;
  goalValue?: number;
  /** Shown above the others on the Trackables list, whatever the sort. */
  pinned?: boolean;
  /** Hidden from the list (under Archived) but kept with all its entries. */
  archived?: boolean;
  /** Position in the list's "My order" sort; unset sorts by name after the ordered ones. */
  sortOrder?: number;
  /** Days a daily goal applies, 0 = Monday ... 6 = Sunday; unset = every day. Other days don't break its streak. */
  scheduleDays?: number[];
  /** Single days skipped ("YYYY-MM-DD", local): they neither count nor break a streak. */
  skipDays?: string[];
  /** Paused through this day (local start-of-day): treated like skipped days, and nothing is due. */
  pausedUntil?: number;
  /** For a dates trackable (displayMode 'ages'): what its dates are; unset = birthdays. See utils/dates.ts. */
  dateKind?: DateKind;
  /** For a dates trackable: show a date in Needs attention this many days ahead; unset = the kind's default. */
  dateLeadDays?: number;
  /**
   * Earlier weekday schedules, each in force on the days before `until` (local
   * start-of-day), so a schedule change doesn't re-judge the past (3.51).
   */
  scheduleHistory?: Array<{ until: number; scheduleDays?: number[] }>;
  /** Kept out of the "on days with" comparisons, its own and the others' (utils/insights.ts). */
  insightsHidden?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What a dates trackable's entries are (utils/dates.ts). */
export type DateKind = 'birthday' | 'anniversary' | 'holiday' | 'countdown';

/**
 * How a date entry comes round again. Unset = the kind's default: yearly on
 * the entry's month and day, or once for a countdown.
 * - yearly: every year on the entry's month and day
 * - once: just the entry's date
 * - every: every `count` months or years from the entry's date (renewals)
 * - nthWeekday: the `nth` (1 to 5, or -1 for last) `weekday` (0 = Monday) of `month` (0 = January)
 * - easter: Easter Sunday (Western), plus `offsetDays`
 */
export type DateRepeat =
  | { type: 'yearly' }
  | { type: 'once' }
  | { type: 'every'; count: number; unit: 'months' | 'years' }
  | { type: 'nthWeekday'; month: number; weekday: number; nth: number }
  | { type: 'easter'; offsetDays?: number };

/** A single logged occurrence of a Trackable. */
export interface TrackableEntry {
  id: string; // uuid
  trackableId: string;
  timestamp: number;
  note?: string;
  tags?: string[];
  /** fieldId -> value, only for fields attached to this entry's trackable. */
  values?: Record<string, number | boolean>;
  /** For an entry of a dates trackable: how it repeats (DateRepeat). */
  dateRepeat?: DateRepeat;
  /** For an entry of a dates trackable: free-text notes (gift ideas, sizes); `note` is its name. */
  details?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Tasks (ARCHITECTURE.md 3.59): projects with sections, tasks with subtasks,
// and due dates that can repeat.
// ---------------------------------------------------------------------------

/** One heading inside a project; tasks point at it by `id`. */
export interface TaskSection {
  id: string; // uuid
  name: string;
}

/** A to-do project. Its sections live inside it, in display order. */
export interface TaskProject {
  id: string; // uuid
  name: string;
  color: string; // hex
  icon?: string; // emoji
  notes?: string;
  sections: TaskSection[];
  /** Hidden from the project list but kept with all its tasks. */
  archived?: boolean;
  /** Position in the project list; unset sorts by name after the ordered ones. */
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * How a task's due date comes round again. Weekdays are 0 = Monday ... 6 =
 * Sunday, as for habit schedules. `every` is the interval (every 2 weeks).
 * - days: every N days after the due date
 * - weeks: every N weeks, on the chosen weekdays
 * - months: every N months on day `day` (1 to 31, clamped to the month's
 *   end; -1 = the last day)
 * - monthsNth: every N months on the `nth` (1 to 5, or -1 for last) `weekday`
 * - years: every N years on the due date's month and day
 * - afterDone: N units after the day it was completed, whatever its due date
 */
export type TaskRepeat =
  | { type: 'days'; every: number }
  | { type: 'weeks'; every: number; weekdays: number[] }
  | { type: 'months'; every: number; day: number }
  | { type: 'monthsNth'; every: number; nth: number; weekday: number }
  | { type: 'years'; every: number }
  | { type: 'afterDone'; every: number; unit: 'days' | 'weeks' | 'months' | 'years' };

/**
 * A to-do. A top-level task belongs to a project (or none: the inbox); a
 * subtask has `parentId` instead and goes wherever its parent goes.
 */
export interface Task {
  id: string; // uuid
  name: string;
  /** Top-level tasks only; unset = no project. */
  projectId?: string;
  /** A section of its project; unset or unknown = above the first section. */
  sectionId?: string;
  /** Set on a subtask: the task it belongs to. */
  parentId?: string;
  notes?: string;
  /** Local calendar day, "YYYY-MM-DD"; unset = no due date. */
  dueOn?: string;
  /** "HH:MM" local time on `dueOn`; unset = any time that day. */
  dueTime?: string;
  /** Needs `dueOn`. Completing a repeating task moves it to its next date instead of closing it. */
  repeat?: TaskRepeat;
  /** When it was completed; unset = open. A repeating task never keeps this. */
  completedAt?: number;
  /** Position among its siblings (same section, or same parent); lower first. */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** One completion of a repeating task: its history, and what Undo puts back. */
export interface TaskCompletion {
  id: string; // uuid
  taskId: string;
  completedAt: number;
  /** The due date it was completed for. */
  dueOn?: string;
  /** The date it moved on to. */
  nextDueOn?: string;
  /** Subtasks that were done and were reset by the move, so Undo can mark them done again. */
  subtaskIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SettingsRecord {
  id: 'app-settings';
  defaultPresetId: string;
  /** Unused since v1.11.0 (in-app milestones replaced notifications); kept so older devices still sync. */
  notificationsEnabled: boolean;
  /** Inches; used to compute BMI from the weight field's logged values. */
  heightInches?: number;
  /** Pounds; drawn as a dashed reference line on the weight field's charts. */
  goalWeightLb?: number;
  /** The number field that holds body weight (BMI, goal line). Unset = the field named "Weight"; see resolveBodyField. */
  weightFieldId?: string;
  /** Fields the Navy body-fat estimate reads. Unset = the field named "Waist" / "Neck" / "Hip". */
  waistFieldId?: string;
  neckFieldId?: string;
  hipFieldId?: string;
  /** Picks the Navy formula; no body-fat estimate until it's set. */
  bodyFatSex?: BodyFatSex;
  /** Daily planned fast start, "HH:MM" local time (utils/fastingSchedule.ts). Unset = no schedule. */
  fastScheduleTime?: string;
  /** Fast lengths you saved yourself, shown with the built-in methods (data/presets.ts). */
  customFastPresets?: CustomFastPreset[];
  /** A plan per weekday, Monday first (utils/fastingSchedule.ts); null entries use the daily defaults. */
  fastWeekPlan?: Array<FastDayPlan | null>;
  /** Comparisons hidden on trackable pages, as "<trackableId>|<otherId>|<0 same day, 1 day after>" (utils/insights.ts). */
  mutedInsights?: string[];
  updatedAt: number;
}

/** One weekday of the weekly fasting plan. */
export interface FastDayPlan {
  /** The method that day; unset = the default method. */
  presetId?: string;
  /** Start time that day, "HH:MM"; unset = the daily start time. */
  time?: string;
  /** No fast planned that day. */
  rest?: boolean;
}

export const DEFAULT_SETTINGS: Omit<SettingsRecord, 'updatedAt'> = {
  id: 'app-settings',
  defaultPresetId: '16:8',
  notificationsEnabled: false,
};

/** Record types that participate in Cloudflare sync (fasts keyed by `uuid`, others already uuid-keyed). */
export type SyncRecordType =
  | 'fasts'
  | 'fieldDefinitions'
  | 'trackableDefinitions'
  | 'trackableEntries'
  | 'taskProjects'
  | 'tasks'
  | 'taskCompletions';

/** A local record of a hard delete, kept only until acknowledged by the sync server, so the delete can propagate to other devices. */
export interface SyncTombstone {
  id?: number;
  recordType: SyncRecordType;
  uuid: string;
  deletedAt: number;
  /** What was deleted, for this device's sync history (e.g. the trackable's name). Never sent. */
  label?: string;
}

/** A record the server refused last time, sent again with every sync until it's accepted or gone. */
export interface SyncRetryKey {
  recordType: SyncRecordType | 'settings';
  uuid: string;
}

/** Singleton row (id fixed to 'sync') tracking this device's sync progress. */
export interface SyncMeta {
  id: 'sync';
  /** Last server-assigned `serverSeq` this device has seen; the pull cursor. */
  cursor: number;
  lastSyncedAt?: number;
  /**
   * Local time the last successful sync started. Records with `updatedAt` at or
   * after it haven't reached the server yet, so the next sync sends only those.
   * Unset until the first successful sync, which sends everything.
   */
  sentThrough?: number;
  /** When this device last sent its whole dataset; a full send runs once a day as a safety net. */
  lastFullSendAt?: number;
  /** When a full send was asked for (an import, whose records keep their own older `updatedAt`, or Full resync); cleared by the next full send that starts after it. */
  fullSendRequestedAt?: number;
  /** Records the server refused last time; see SyncRetryKey. */
  retry?: SyncRetryKey[];
  /** This device's id in the server's device list; made on first use, new again after an erase. */
  deviceId?: string;
  /** What this device is called in the device list and activity, e.g. "Phone". */
  deviceName?: string;
  /** Set by Sign out, so the pill says "Signed out" rather than "Login expired"; cleared by the next good sync. */
  signedOutAt?: number;
}

/** A row of this device's own sync history (see utils/syncHistory.ts), kept 30 days. */
export type SyncLogRow = SyncHistoryEntry & { id?: number };

/** Thrown when a fast would be saved with a start date that's already taken by another fast. */
export class DuplicateStartDayError extends Error {
  constructor() {
    super('A fast already starts on that day. Edit that one instead, or pick a different date.');
    this.name = 'DuplicateStartDayError';
  }
}
