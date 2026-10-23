import type { FastDayPlan, FastRecord, SettingsRecord } from '../db';
import { weekdayIndex } from './trackableGoals';
import { addDays, formatClockTime, HOUR_MS, startOfDay } from './time';

/**
 * An optional fasting schedule: the time a fast is planned to start each day
 * (settings.fastScheduleTime, "HH:MM" local time), and since v1.11.0 a plan
 * per weekday (settings.fastWeekPlan, Monday first) that can give a day its
 * own method and start time, or make it a rest day.
 */

/** What the schedule reads: the settings, or for tests just a daily time. */
export type ScheduleInput = string | undefined | Pick<SettingsRecord, 'fastScheduleTime' | 'fastWeekPlan' | 'defaultPresetId'>;

export interface DayPlan {
  /** Planned start "HH:MM", or undefined when no start is planned that day. */
  time?: string;
  /** The method that day: the plan's, else the default method. */
  presetId?: string;
  rest: boolean;
}

/** The plan for the day starting at `day`: its weekday's entry over the daily defaults. */
export function planForDay(input: ScheduleInput, day: number): DayPlan {
  if (typeof input !== 'object') return { time: input, rest: false };
  const entry: FastDayPlan | null | undefined = input.fastWeekPlan?.[weekdayIndex(day)];
  if (entry?.rest) return { rest: true };
  return { time: entry?.time ?? input.fastScheduleTime, presetId: entry?.presetId ?? input.defaultPresetId, rest: false };
}

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
  /** e.g. "Next fast starts in 2h 15m (8:00 PM)", "Next fast starts Sun 7:30 PM" or "Your fast was due at 8:00 PM, 25m ago". */
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
  schedule: ScheduleInput,
  fasts: readonly Pick<FastRecord, 'startTime'>[],
  now: number = Date.now(),
): ScheduleStatus | null {
  const today = startOfDay(now);
  const startedToday = fasts.some((f) => startOfDay(f.startTime) === today);
  const todayTime = parseScheduleTime(planForDay(schedule, today).time);
  if (todayTime && !startedToday) {
    const todays = scheduledOn(today, todayTime);
    if (now >= todays) {
      return { text: `Your fast was due at ${formatClockTime(todays)}, ${formatCountdown(now - todays)} ago`, late: true, at: todays };
    }
    return { text: `Next fast starts in ${formatCountdown(todays - now)} (${formatClockTime(todays)})`, late: false, at: todays };
  }
  // Today's is done, a rest day or unplanned: the next planned day within a week.
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, i);
    const time = parseScheduleTime(planForDay(schedule, day).time);
    if (!time) continue;
    const at = scheduledOn(day, time);
    const text =
      at - now < 24 * HOUR_MS
        ? `Next fast starts in ${formatCountdown(at - now)} (${formatClockTime(at)})`
        : `Next fast starts ${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })} ${formatClockTime(at)}`;
    return { text, late: false, at };
  }
  return null;
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
