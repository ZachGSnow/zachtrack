// The daily reminder (ARCHITECTURE.md 3.73): what is due, worked out on the
// server with the app's own code, sent once a day at each device's chosen
// time by the scheduled Worker (workers/backup). The app shows the same
// things in Needs attention and on Today; this only brings them to the lock
// screen when the app is closed.

import type { FieldDefinition, Task, TaskProject, TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { attentionItems } from '../src/lib/utils/attention';
import { dueTasks } from '../src/lib/utils/tasks';
import { mapEntryRow, mapFieldRow, mapTaskProjectRow, mapTaskRow, mapTrackableRow } from './rows';
import { sendPush, type PushTarget, type SendOutcome, type VapidKeys } from './webpush';

/** A row of `pushSubscriptions` (migration 0012). */
export interface PushSubscriptionRow {
  endpoint: string;
  deviceId: string | null;
  p256dh: string;
  auth: string;
  timeZone: string;
  /** "HH:MM", local to `timeZone`. */
  remindAt: string;
  includeHabits: number;
  includeTasks: number;
  includeDates: number;
  /** 1: name what's due; 0: counts only, since the lock screen shows it. */
  namedText: number;
  /** "YYYY-MM-DD" in `timeZone`: the day the reminder last went (or had nothing to say). */
  lastSentOn: string | null;
  failures: number;
}

/** A reminder that hasn't gone by this long after its time waits for the next day. */
const LATE_LIMIT_MIN = 180;
/** Failed sends are retried each run until this many, then the next day. */
const MAX_FAILURES = 5;
/** Entries older than this aren't read: no goal looks further back for what's due today. */
const ENTRY_WINDOW_DAYS = 400;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time in `timeZone` at `at`. */
export function localParts(at: number, timeZone: string): { date: string; minutes: number; utcOfWall: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const [y, mo, d, h, mi, s] = [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: h * 60 + mi, utcOfWall: Date.UTC(y, mo - 1, d, h, mi, s) };
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Whether this subscription's reminder is due at `now`: past its time today, not sent today, not given up on. */
export function isDue(row: Pick<PushSubscriptionRow, 'timeZone' | 'remindAt' | 'lastSentOn' | 'failures'>, now: number): boolean {
  const local = localParts(now, row.timeZone);
  if (row.lastSentOn === local.date) return false;
  const [h, m] = row.remindAt.split(':').map(Number);
  const late = local.minutes - (h * 60 + m);
  return late >= 0 && late < LATE_LIMIT_MIN && row.failures < MAX_FAILURES;
}

/**
 * Moves a timestamp so that this runtime's local calendar reads it as the
 * wall-clock time in `timeZone`. The app's goal code works in local days;
 * a Worker's local time is UTC, so without this a day would end at UTC
 * midnight. Each timestamp gets its own offset, so DST is right on both
 * sides of a change. Offsets are cached by the hour.
 */
export function shifter(timeZone: string): (t: number) => number {
  const cache = new Map<number, number>();
  return (t) => {
    const hour = Math.floor(t / 3_600_000);
    let shift = cache.get(hour);
    if (shift == null) {
      const zoneOffset = localParts(hour * 3_600_000, timeZone).utcOfWall - hour * 3_600_000;
      const runtimeOffset = -new Date(hour * 3_600_000).getTimezoneOffset() * 60_000;
      shift = zoneOffset - runtimeOffset;
      cache.set(hour, shift);
    }
    return t + shift;
  };
}

/** What the reminder is built from: read once per run and shared by every device due. */
export interface ReminderData {
  trackables: TrackableDefinition[];
  fields: FieldDefinition[];
  entries: TrackableEntry[];
  tasks: Task[];
  projects: TaskProject[];
}

export async function loadReminderData(db: D1Database, now: number): Promise<ReminderData> {
  const since = now - ENTRY_WINDOW_DAYS * 86_400_000;
  const [trackables, fields, entries, tasks, projects] = await db.batch([
    db.prepare('SELECT * FROM trackableDefinitions WHERE deletedAt IS NULL AND (archived IS NULL OR archived = 0)'),
    db.prepare('SELECT * FROM fieldDefinitions WHERE deletedAt IS NULL'),
    // Goal trackables' recent entries, and every date of a dates trackable.
    db.prepare(
      `SELECT e.* FROM trackableEntries e JOIN trackableDefinitions t ON t.id = e.trackableId
       WHERE e.deletedAt IS NULL AND t.deletedAt IS NULL AND (t.archived IS NULL OR t.archived = 0)
         AND ((t.goalType IS NOT NULL AND e.timestamp >= ?1) OR t.displayMode = 'ages')`,
    ).bind(since),
    // Open tasks with a date, and their parents (a subtask's project is its top task's).
    db.prepare('SELECT * FROM tasks WHERE deletedAt IS NULL AND completedAt IS NULL'),
    db.prepare('SELECT * FROM taskProjects WHERE deletedAt IS NULL'),
  ]);
  const rows = (r: D1Result) => (r.results ?? []) as Record<string, unknown>[];
  return {
    trackables: rows(trackables).map(mapTrackableRow) as TrackableDefinition[],
    fields: rows(fields).map(mapFieldRow) as FieldDefinition[],
    entries: rows(entries).map(mapEntryRow) as TrackableEntry[],
    tasks: rows(tasks).map(mapTaskRow) as Task[],
    projects: rows(projects).map(mapTaskProjectRow) as TaskProject[],
  };
}

export interface ReminderMessage {
  title: string;
  body: string;
  url: string;
  /** How many things it mentions; nothing is sent when it's 0. */
  count: number;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** What's due for a device, in its time zone, as the notification's text. */
export function buildReminder(data: ReminderData, row: Pick<PushSubscriptionRow, 'timeZone' | 'includeHabits' | 'includeTasks' | 'includeDates' | 'namedText'>, now: number): ReminderMessage {
  const shift = shifter(row.timeZone);
  const localNow = shift(now);
  // Times the goal code reads as days: entries' timestamps, pauses, and a date's timestamp (its day).
  const entries = data.entries.map((e) => ({ ...e, timestamp: shift(e.timestamp) }));
  const trackables = data.trackables.map((t) => (t.pausedUntil != null ? { ...t, pausedUntil: shift(t.pausedUntil) } : t));
  const items = attentionItems({ trackables, fields: data.fields, entries, recentFasts: [], scheduleTime: undefined as never }, localNow);
  const datesIds = new Set(data.trackables.filter((t) => t.displayMode === 'ages').map((t) => t.id));
  const habits = row.includeHabits ? items.filter((i) => !datesIds.has(i.id)) : [];
  const dates = row.includeDates ? items.filter((i) => datesIds.has(i.id)) : [];
  const today = localParts(now, row.timeZone).date;
  const archived = new Set(data.projects.filter((p) => p.archived).map((p) => p.id));
  const tasks = row.includeTasks ? dueTasks(data.tasks, today, archived) : [];
  const count = habits.length + dates.length + tasks.length;

  let body: string;
  if (!row.namedText) {
    const parts = [habits.length && plural(habits.length, 'habit'), tasks.length && plural(tasks.length, 'task'), dates.length && plural(dates.length, 'date')].filter(Boolean) as string[];
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
    body = `${list} need${count === 1 ? 's' : ''} a look today.`;
  } else {
    const lines = [
      ...habits.map((i) => `${i.name}: ${i.text}`),
      ...tasks.map((t) => `${t.name || 'Untitled'}${t.dueOn && t.dueOn < today ? ' (overdue)' : ''}`),
      ...dates.map((i) => `${i.name}: ${i.text}`),
    ];
    body = lines.length > 5 ? `${lines.slice(0, 4).join('\n')}\nand ${lines.length - 4} more` : lines.join('\n');
  }
  return { title: 'ZachTrack', body, url: '/#/', count };
}

export interface ReminderEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export function vapidKeysFrom(env: ReminderEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'https://zachtrack.invalid' };
}

export interface RunSummary {
  checked: number;
  outcomes: Array<{ outcome: SendOutcome | 'nothing due'; count: number }>;
}

/**
 * One scheduled run: sends each device whose time has come its reminder, at
 * most once a day. Reads only the subscriptions unless one is due, so most
 * runs stay well inside the free plan's 10 ms of CPU.
 */
export async function sendDueReminders(env: ReminderEnv, now: number, fetcher: typeof fetch = fetch): Promise<RunSummary> {
  const keys = vapidKeysFrom(env);
  const rows = ((await env.DB.prepare('SELECT * FROM pushSubscriptions').all()).results ?? []) as unknown as PushSubscriptionRow[];
  const due = rows.filter((r) => isDue(r, now));
  const summary: RunSummary = { checked: rows.length, outcomes: [] };
  if (due.length === 0) return summary;
  if (!keys) {
    console.error('reminders: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set to send reminders');
    return summary;
  }
  const data = await loadReminderData(env.DB, now);
  for (const row of due) {
    const today = localParts(now, row.timeZone).date;
    const message = buildReminder(data, row, now);
    if (message.count === 0) {
      await env.DB.prepare('UPDATE pushSubscriptions SET lastSentOn = ?, failures = 0 WHERE endpoint = ?').bind(today, row.endpoint).run();
      summary.outcomes.push({ outcome: 'nothing due', count: 0 });
      continue;
    }
    const outcome = await sendPush(row as PushTarget, message, keys, fetcher).catch(() => 'failed' as const);
    if (outcome === 'sent') await env.DB.prepare('UPDATE pushSubscriptions SET lastSentOn = ?, failures = 0 WHERE endpoint = ?').bind(today, row.endpoint).run();
    else if (outcome === 'gone') await env.DB.prepare('DELETE FROM pushSubscriptions WHERE endpoint = ?').bind(row.endpoint).run();
    else await env.DB.prepare('UPDATE pushSubscriptions SET failures = failures + 1 WHERE endpoint = ?').bind(row.endpoint).run();
    summary.outcomes.push({ outcome, count: message.count });
  }
  return summary;
}
