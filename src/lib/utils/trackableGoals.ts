import type { FieldDefinition, TrackableDefinition, TrackableGoalType } from '../db';
import { addDays, DAY_MS, startOfDay } from './time';
import { bucketStart, computeFieldValuesByDay, formatTimeSinceAdaptive, type TimestampedValues } from './trackableStats';

/**
 * Optional goals, the part of a habit or "days since" app that makes streaks
 * and reminders mean something:
 * - dailyTotal: reach an amount of the first number field each day (2,000 kcal, 64 oz)
 * - perDay:     log it N times each day (water 8 times, stretch 3 times)
 * - perWeek:    log on N days each week, Monday to Sunday (gym 3 times a week)
 * - everyDays:  do it every N days; due and overdue follow from the last entry
 * - avoid:      less is better; the streak is the time since it last happened
 *
 * The daily goals (dailyTotal, perDay) can apply on chosen weekdays only
 * (scheduleDays). Days off the schedule, skipped days and days while paused
 * neither count toward a streak nor break it; while paused nothing is due.
 */

export const GOAL_TYPES: TrackableGoalType[] = ['dailyTotal', 'perDay', 'perWeek', 'everyDays', 'avoid'];

export const GOAL_LABELS: Record<TrackableGoalType, string> = {
  dailyTotal: 'Reach a total each day',
  perDay: 'Times per day',
  perWeek: 'Times per week',
  everyDays: 'Every N days',
  avoid: 'Avoid it',
};

/** Goals that apply day by day, and so can follow a weekday schedule. */
export const DAILY_GOALS: readonly TrackableGoalType[] = ['dailyTotal', 'perDay'];

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Scheduled = Pick<TrackableDefinition, 'goalType' | 'scheduleDays' | 'skipDays' | 'pausedUntil'>;

/** "YYYY-MM-DD" for a local day, the form `skipDays` stores. */
export function isoDay(day: number): string {
  const d = new Date(day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday = 0 ... Sunday = 6. */
export function weekdayIndex(day: number): number {
  return (new Date(day).getDay() + 6) % 7;
}

export function isPaused(trackable: Pick<TrackableDefinition, 'pausedUntil'>, day: number): boolean {
  return trackable.pausedUntil != null && startOfDay(day) <= startOfDay(trackable.pausedUntil);
}

/** Why a day doesn't count for this trackable's goal, or null when it does. */
export function offDayReason(trackable: Scheduled, day: number): 'paused' | 'skipped' | 'rest' | null {
  if (isPaused(trackable, day)) return 'paused';
  if (trackable.skipDays?.includes(isoDay(day))) return 'skipped';
  const daily = trackable.goalType != null && DAILY_GOALS.includes(trackable.goalType);
  if (daily && trackable.scheduleDays?.length && !trackable.scheduleDays.includes(weekdayIndex(day))) return 'rest';
  return null;
}

export type GoalState = 'done' | 'progress' | 'due' | 'overdue' | 'ok';

export interface GoalStatus {
  /** e.g. "1,450 / 2,000 kcal today", "2 of 3 this week", "Due in 3d", "12d since last". */
  text: string;
  state: GoalState;
  /** 0 to 1, for a progress bar. */
  progress?: number;
  /** e.g. "5 days met", "3 weeks in a row", "4 on time", "best 21d". */
  streak?: string;
  /** Lower needs attention sooner: overdue, then due, then the rest. For sorting the list. */
  urgency: number;
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmt = (v: number) => nf.format(Math.abs(v) >= 1000 ? Math.round(v) : v);

/** Calendar days from `from` to `to` (both local start-of-day), safe across DST. */
function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/** The number field a daily-total goal counts: the first one that sums same-day entries, else the first number. */
export function goalField(fields: readonly FieldDefinition[]): FieldDefinition | undefined {
  return fields.find((f) => f.kind === 'number' && f.aggregation === 'sum') ?? fields.find((f) => f.kind === 'number');
}

/** The goal in words, for the edit sheet and the detail page: "2,000 kcal a day", "3 times a week". */
export function describeGoal(
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'scheduleDays'>,
  fields: readonly FieldDefinition[],
): string | null {
  const { goalType: type, goalValue: n } = trackable;
  if (!type) return null;
  if (type === 'avoid') return 'Avoid it';
  if (n == null) return null;
  const days = trackable.scheduleDays?.length && trackable.scheduleDays.length < 7 ? trackable.scheduleDays : null;
  const on = days ? ` on ${[...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]).join(', ')}` : '';
  if (type === 'dailyTotal') {
    const f = goalField(fields);
    return `${fmt(n)}${f?.unit ? ` ${f.unit}` : ''} a day${on}${f ? ` (${f.name})` : ''}`;
  }
  if (type === 'perDay') return `${n === 1 ? 'Once' : `${fmt(n)} times`} a day${on}`;
  if (type === 'perWeek') return `${fmt(n)} ${n === 1 ? 'time' : 'times'} a week`;
  return n === 1 ? 'Every day' : `Every ${fmt(n)} days`;
}

export function goalStatus(
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue'> & Partial<Scheduled>,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  now: number = Date.now(),
): GoalStatus | null {
  const type = trackable.goalType;
  const goal = trackable.goalValue;
  if (!type || (type !== 'avoid' && (goal == null || goal <= 0))) return null;
  const today = startOfDay(now);
  const times = entries.map((e) => e.timestamp).sort((a, b) => a - b);
  const last = times.at(-1);

  if (type !== 'avoid' && isPaused(trackable, today)) {
    return {
      text: `Paused until ${new Date(trackable.pausedUntil!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      state: 'ok',
      urgency: 900,
    };
  }

  if (type === 'dailyTotal' || type === 'perDay') {
    let valueOn: (day: number) => number;
    let unit = '';
    if (type === 'dailyTotal') {
      const field = goalField(fields);
      if (!field) return null;
      const byDay = computeFieldValuesByDay(entries as TimestampedValues[], field);
      valueOn = (day) => byDay.get(day) ?? 0;
      unit = field.unit ? ` ${field.unit}` : '';
    } else {
      const counts = new Map<number, number>();
      for (const t of times) counts.set(startOfDay(t), (counts.get(startOfDay(t)) ?? 0) + 1);
      valueOn = (day) => counts.get(day) ?? 0;
    }
    const met = (day: number) => valueOn(day) >= goal!;
    // Days met in a row, back from today (or yesterday while today is still open); days off neither count nor break it.
    const earliest = times.length ? startOfDay(times[0]) : today;
    let streak = 0;
    for (let d = met(today) || offDayReason(trackable, today) ? today : addDays(today, -1); d >= earliest; d = addDays(d, -1)) {
      if (met(d)) streak += 1;
      else if (!offDayReason(trackable, d)) break;
    }
    const value = valueOn(today);
    const done = value >= goal!;
    const off = offDayReason(trackable, today);
    const progressText = type === 'perDay' ? `${fmt(value)} of ${fmt(goal!)} today` : `${fmt(value)} / ${fmt(goal!)}${unit} today`;
    return {
      text: off && !done ? (off === 'rest' ? 'Rest day' : 'Skipped today') : progressText,
      state: done ? 'done' : off ? 'ok' : 'progress',
      progress: Math.min(1, value / goal!),
      streak: streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'} met` : undefined,
      urgency: done ? 1000 : off ? 900 : 100,
    };
  }

  if (type === 'perWeek') {
    const weekStart = bucketStart(now, 'week');
    const daysIn = (start: number) => new Set(times.filter((t) => t >= start && t < addDays(start, 7)).map(startOfDay)).size;
    const count = daysIn(weekStart);
    const daysLeft = 7 - daysBetween(weekStart, today); // including today
    const loggedToday = last != null && startOfDay(last) === today;
    let weeks = count >= goal! ? 1 : 0;
    for (let w = addDays(weekStart, -7); daysIn(w) >= goal!; w = addDays(w, -7)) weeks += 1;
    const needed = goal! - count;
    const state: GoalState =
      needed <= 0 ? 'done' : needed > daysLeft - (loggedToday ? 1 : 0) ? 'overdue' : needed >= daysLeft && !loggedToday ? 'due' : 'progress';
    return {
      text: `${count} of ${fmt(goal!)} this week`,
      state,
      progress: Math.min(1, count / goal!),
      streak: weeks > 0 ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'} in a row` : undefined,
      urgency: state === 'overdue' ? 5 : state === 'due' ? 10 : state === 'done' ? 1000 : 100 + daysLeft - needed,
    };
  }

  if (type === 'everyDays') {
    if (last == null) return { text: 'Due now', state: 'due', progress: 1, urgency: 0 };
    const dueDay = addDays(startOfDay(last), goal!);
    const left = daysBetween(today, dueDay);
    let onTime = 0;
    for (let i = times.length - 1; i > 0; i--) {
      if (daysBetween(startOfDay(times[i - 1]), startOfDay(times[i])) > goal!) break;
      onTime += 1;
    }
    return {
      text: left > 1 ? `Due in ${left}d` : left === 1 ? 'Due tomorrow' : left === 0 ? 'Due today' : `Overdue by ${-left}d`,
      state: left > 0 ? 'ok' : left === 0 ? 'due' : 'overdue',
      progress: Math.min(1, Math.max(0, (now - last) / (goal! * DAY_MS))),
      streak: onTime > 0 ? `${onTime} on time` : undefined,
      urgency: left,
    };
  }

  // avoid: the time since it last happened is the streak.
  if (last == null) return { text: 'Not logged yet', state: 'ok', urgency: 500 };
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const best = Math.max(now - last, ...gaps);
  return {
    text: `${formatTimeSinceAdaptive(now - last)} since last`,
    state: 'ok',
    streak: `best ${formatTimeSinceAdaptive(best)}`,
    urgency: 500,
  };
}

/** The list card's line when a goal is set: the goal status first, then what the kind adds. */
export function goalCardLine(status: GoalStatus, type: TrackableGoalType, kindCard: string): string {
  if (type === 'dailyTotal' || type === 'perDay' || type === 'avoid') return status.streak ? `${status.text} \u00b7 ${status.streak}` : status.text;
  return `${status.text} \u00b7 ${kindCard}`;
}

export const GOAL_STATE_COLORS: Record<GoalState, string | undefined> = {
  done: 'var(--color-brand)',
  progress: undefined,
  due: '#fbbf24',
  overdue: '#f87171',
  ok: undefined,
};
