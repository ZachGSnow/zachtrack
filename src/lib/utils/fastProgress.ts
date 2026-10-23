import type { FastRecord } from '../db';
import { getNextZone, getZoneForHour, ZONES } from '../data/zones';
import { formatCountdown } from './fastingSchedule';
import { formatClockTime, formatHoursShort, HOUR_MS, startOfDay } from './time';

// What the timer says about a running fast besides the clock (Fasting.svelte):
// when it started, when the goal is, what's next, which milestone it has
// reached, and how an ending compares with the goal. Pure, so unit tested in
// tests/fastProgress.test.ts.

type Fast = Pick<FastRecord, 'uuid' | 'startTime' | 'targetHours'>;

/** " yesterday", " tomorrow" or "" relative to `now`'s day. */
function dayWord(ms: number, now: number): string {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / (24 * HOUR_MS));
  return diff === 0 ? '' : diff === 1 ? ' tomorrow' : diff === -1 ? ' yesterday' : ` ${new Date(ms).toLocaleDateString(undefined, { weekday: 'short' })}`;
}

export interface FastTimeline {
  /** "Started 8:12 PM yesterday" */
  started: string;
  /** "Goal 12:12 PM, 3h 10m left" or "Goal reached at 12:12 PM"; null for a count-up fast. */
  goal: string | null;
  /** "Fat burning in 2h 14m"; null in the last zone. */
  next: string | null;
}

export function fastTimeline(fast: Fast, now: number): FastTimeline {
  const started = `Started ${formatClockTime(fast.startTime)}${dayWord(fast.startTime, now)}`;
  let goal: string | null = null;
  if (fast.targetHours) {
    const at = fast.startTime + fast.targetHours * HOUR_MS;
    goal = now < at ? `Goal ${formatClockTime(at)}${dayWord(at, now)}, ${formatCountdown(at - now)} left` : `Goal reached at ${formatClockTime(at)}${dayWord(at, now)}`;
  }
  const hours = Math.max(0, (now - fast.startTime) / HOUR_MS);
  const nextZone = getNextZone(getZoneForHour(hours));
  const next = nextZone ? `${nextZone.title} in ${formatCountdown(fast.startTime + nextZone.hourStart * HOUR_MS - now)}` : null;
  return { started, goal, next };
}

export interface Milestone {
  /** Stable per fast and milestone, so a dismissed banner stays dismissed. */
  key: string;
  /** "Goal reached: 16h" or "You reached Mild Ketosis (12h)" */
  title: string;
  text: string;
}

/**
 * The latest milestone a running fast has reached, for the in-app banner:
 * the goal, or the deepest zone after the first. A goal reached after the
 * deepest zone so far wins, since it's the more recent news.
 */
export function latestMilestone(fast: Fast, now: number): Milestone | null {
  const hours = (now - fast.startTime) / HOUR_MS;
  const zone = [...ZONES].reverse().find((z) => z.hourStart > 0 && hours >= z.hourStart);
  const goalReached = !!fast.targetHours && hours >= fast.targetHours;
  if (goalReached && (!zone || fast.targetHours! >= zone.hourStart)) {
    return { key: `${fast.uuid}:goal`, title: `Goal reached: ${formatHoursShort(fast.targetHours!)}`, text: 'End your fast whenever you are ready.' };
  }
  if (!zone) return null;
  return { key: `${fast.uuid}:${zone.id}`, title: `You reached ${zone.title} (${zone.hourStart}h)`, text: zone.milestone };
}

export interface EndSummary {
  /** "16h 12m" */
  duration: string;
  /** "Goal of 16h reached", "1h 20m short of 16h", or null for a count-up fast. */
  goal: string | null;
  goalMet: boolean | null;
  /** The deepest zone reached. */
  zone: string;
}

export function endSummary(fast: Fast, end: number): EndSummary {
  const hours = Math.max(0, (end - fast.startTime) / HOUR_MS);
  const target = fast.targetHours;
  const goalMet = target ? hours >= target : null;
  const goal = target
    ? goalMet
      ? `Goal of ${formatHoursShort(target)} reached`
      : `${formatHoursShort(target - hours)} short of ${formatHoursShort(target)}`
    : null;
  return { duration: formatHoursShort(hours), goal, goalMet, zone: getZoneForHour(hours).title };
}

/** A start time `minutesAgo` before `now`, for "Started earlier". */
export function startedAgo(minutesAgo: number, now: number): number {
  return now - minutesAgo * 60_000;
}
