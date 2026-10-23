import type { FastRecord } from '../db';
import { addDays, formatClockTime, HOUR_MS, startOfDay } from './time';

/**
 * An optional daily fasting schedule: the time a fast is planned to start each
 * day (settings.fastScheduleTime, "HH:MM" local time). The default method's
 * target then decides when the eating window opens.
 */

export function parseScheduleTime(value: string | undefined): { hours: number; minutes: number } | null {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/** The scheduled start on the calendar day starting at `day` (local start-of-day). */
function scheduledOn(day: number, time: { hours: number; minutes: number }): number {
  const d = new Date(day);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d.getTime();
}

/** "2h 15m", "45m" */
export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export interface ScheduleStatus {
  /** e.g. "Next fast starts in 2h 15m (8:00 PM)" or "Your fast was due at 8:00 PM, 25m ago". */
  text: string;
  late: boolean;
  /** When the next (or missed) scheduled start is. */
  at: number;
}

/**
 * Where you are against the schedule while no fast is running. Today's start
 * counts as done once a fast has started today; until then, after the
 * scheduled time, it is late.
 */
export function scheduleStatus(
  scheduleTime: string | undefined,
  fasts: readonly Pick<FastRecord, 'startTime'>[],
  now: number = Date.now(),
): ScheduleStatus | null {
  const time = parseScheduleTime(scheduleTime);
  if (!time) return null;
  const today = startOfDay(now);
  const todays = scheduledOn(today, time);
  const startedToday = fasts.some((f) => startOfDay(f.startTime) === today);
  if (now < todays || startedToday) {
    const at = now < todays && !startedToday ? todays : scheduledOn(addDays(today, 1), time);
    return { text: `Next fast starts in ${formatCountdown(at - now)} (${formatClockTime(at)})`, late: false, at };
  }
  return { text: `Your fast was due at ${formatClockTime(todays)}, ${formatCountdown(now - todays)} ago`, late: true, at: todays };
}

/** When the next reminder to start should fire: the next scheduled start after `now`, unless a fast already started that day. */
export function nextStartReminder(
  scheduleTime: string | undefined,
  fasts: readonly Pick<FastRecord, 'startTime'>[],
  now: number = Date.now(),
): number | null {
  const time = parseScheduleTime(scheduleTime);
  if (!time) return null;
  for (let i = 0; i < 2; i++) {
    const day = addDays(startOfDay(now), i);
    const at = scheduledOn(day, time);
    if (at > now && !fasts.some((f) => startOfDay(f.startTime) === day)) return at;
  }
  return scheduledOn(addDays(startOfDay(now), 2), time);
}

/** "Eating window opens at 12:00 PM tomorrow" while fasting toward a target; "Goal reached at ..." after it. */
export function eatingWindowText(fast: Pick<FastRecord, 'startTime' | 'targetHours'>, now: number = Date.now()): string | null {
  if (!fast.targetHours) return null;
  const opens = fast.startTime + fast.targetHours * HOUR_MS;
  const dayWord = (ms: number) => {
    const diff = Math.round((startOfDay(ms) - startOfDay(now)) / (24 * HOUR_MS));
    return diff === 0 ? '' : diff === 1 ? ' tomorrow' : diff === -1 ? ' yesterday' : '';
  };
  return now < opens
    ? `Eating window opens at ${formatClockTime(opens)}${dayWord(opens)}`
    : `Goal reached at ${formatClockTime(opens)}${dayWord(opens)}`;
}
