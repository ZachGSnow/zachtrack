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
  due: 'var(--color-warn)',
  overdue: 'var(--color-danger)',
  ok: undefined,
};

// ---------------------------------------------------------------------------
// The stat tiles on a goal trackable's page (TrackableDetail.svelte): how the
// goal is going rather than the kind's figures (3.43). Pure; tested in
// tests/trackableGoals.test.ts.
// ---------------------------------------------------------------------------

export interface GoalStat {
  label: string;
  value: string;
  /** Unused for goals; shared shape with a kind's stat tile (trackableKinds.KindStat). */
  change?: number;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The value each day counts toward a daily goal: the total of its field, or how many entries. */
function dailyValueOn(type: 'dailyTotal' | 'perDay', entries: readonly TimestampedValues[], fields: readonly FieldDefinition[]): ((day: number) => number) | null {
  if (type === 'dailyTotal') {
    const field = goalField(fields);
    if (!field) return null;
    const byDay = computeFieldValuesByDay(entries as TimestampedValues[], field);
    return (day) => byDay.get(day) ?? 0;
  }
  const counts = new Map<number, number>();
  for (const e of entries) counts.set(startOfDay(e.timestamp), (counts.get(startOfDay(e.timestamp)) ?? 0) + 1);
  return (day) => counts.get(day) ?? 0;
}

export function goalStats(
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt'> & Partial<Scheduled>,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  now: number = Date.now(),
): GoalStat[] | null {
  const type = trackable.goalType;
  const goal = trackable.goalValue;
  if (!type || (type !== 'avoid' && (goal == null || goal <= 0))) return null;
  const today = startOfDay(now);
  const times = entries.map((e) => e.timestamp).sort((a, b) => a - b);
  const dash = '\u2014';
  const since30 = addDays(today, -29);
  // How established the habit is (habitStrength below), first on every goal but avoid.
  const strengthTile = (): GoalStat => {
    const strength = habitStrength(trackable, entries, fields, now);
    return { label: 'Strength', value: strength == null ? dash : `${Math.round(strength * 100)}%` };
  };

  if (type === 'dailyTotal' || type === 'perDay') {
    const valueOn = dailyValueOn(type, entries, fields);
    if (!valueOn) return null;
    const met = (day: number) => valueOn(day) >= goal!;
    const earliest = Math.min(startOfDay(trackable.createdAt ?? now), times.length ? startOfDay(times[0]) : today);
    // The last 30 scheduled days; today counts only once it's met, since it's still open.
    let scheduled = 0;
    let metCount = 0;
    for (let d = Math.max(since30, earliest); d <= today; d = addDays(d, 1)) {
      if (offDayReason(trackable, d) || (d === today && !met(d))) continue;
      scheduled += 1;
      if (met(d)) metCount += 1;
    }
    // Runs of met days; off days neither count nor break a run.
    let best = 0;
    let run = 0;
    for (let d = earliest; d <= today; d = addDays(d, 1)) {
      if (met(d)) run += 1;
      else if (!offDayReason(trackable, d) && d !== today) run = 0;
      best = Math.max(best, run);
    }
    const current = goalStatus(trackable, entries, fields, now)?.streak?.match(/^(\d+) /)?.[1] ?? '0';
    return [
      strengthTile(),
      { label: 'Met, last 30 days', value: scheduled ? `${metCount} of ${scheduled} (${Math.round((metCount / scheduled) * 100)}%)` : dash },
      { label: 'Current streak', value: plural(Number(current), 'day') },
      { label: 'Best streak', value: plural(best, 'day') },
    ];
  }

  if (type === 'perWeek') {
    const weekStart = bucketStart(now, 'week');
    const daysIn = (start: number) => new Set(times.filter((t) => t >= start && t < addDays(start, 7)).map(startOfDay)).size;
    const count = daysIn(weekStart);
    const firstWeek = times.length ? bucketStart(times[0], 'week') : weekStart;
    // The last 12 finished weeks plus this one once it's met.
    let weeks = 0;
    let metWeeks = 0;
    for (let w = addDays(weekStart, -7 * 12); w <= weekStart; w = addDays(w, 7)) {
      if (w < firstWeek) continue;
      const done = daysIn(w) >= goal!;
      if (w === weekStart && !done) continue;
      weeks += 1;
      if (done) metWeeks += 1;
    }
    let best = 0;
    let run = 0;
    for (let w = firstWeek; w <= weekStart; w = addDays(w, 7)) {
      if (daysIn(w) >= goal!) run += 1;
      else if (w !== weekStart) run = 0;
      best = Math.max(best, run);
    }
    let current = count >= goal! ? 1 : 0;
    for (let w = addDays(weekStart, -7); w >= firstWeek && daysIn(w) >= goal!; w = addDays(w, -7)) current += 1;
    return [
      strengthTile(),
      { label: 'Weeks met (12)', value: weeks ? `${metWeeks} of ${weeks}` : dash },
      { label: 'Current streak', value: plural(current, 'week') },
      { label: 'Best streak', value: plural(best, 'week') },
    ];
  }

  if (type === 'everyDays') {
    // Each interval between two logs, on time when it's within the goal; the last 90 days by the later log.
    const since90 = addDays(today, -89);
    let recent = 0;
    let recentOnTime = 0;
    let best = 0;
    let run = 0;
    for (let i = 1; i < times.length; i++) {
      const onTime = daysBetween(startOfDay(times[i - 1]), startOfDay(times[i])) <= goal!;
      if (times[i] >= since90) {
        recent += 1;
        if (onTime) recentOnTime += 1;
      }
      run = onTime ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return [
      strengthTile(),
      { label: 'On time (90d)', value: recent ? `${recentOnTime} of ${recent}` : dash },
      { label: 'Current streak', value: `${run} on time` },
      { label: 'Best streak', value: `${best} on time` },
    ];
  }

  // avoid: how long since, the longest gap, and the slips lately.
  const last = times.at(-1);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const bestGap = last == null ? null : Math.max(now - last, ...gaps);
  return [
    { label: 'Since last', value: last == null ? 'Never' : formatTimeSinceAdaptive(now - last) },
    { label: 'Best', value: bestGap == null ? dash : formatTimeSinceAdaptive(bestGap) },
    { label: 'Last 30 days', value: plural(times.filter((t) => t >= since30).length, 'slip') },
    { label: 'Last 90 days', value: plural(times.filter((t) => t >= addDays(today, -89)).length, 'slip') },
  ];
}

// ---------------------------------------------------------------------------
// Habit strength (3.48): a forgiving score in the style of Loop Habit
// Tracker. Each day moves it toward 1 when the goal was met and toward 0 when
// it wasn't, by an amount that depends on how often the goal asks for it, so
// one missed day costs a little instead of resetting a streak to zero. Off
// days (rest, skipped, paused) leave it alone; today counts only once it's
// met, since it's still open.
// ---------------------------------------------------------------------------

/** How many times a day the goal asks for: 1 for daily goals, N/7 for N a week, 1/N for every N days. */
function perDayFrequency(type: TrackableGoalType, goal: number): number {
  if (type === 'perWeek') return Math.min(1, goal / 7);
  if (type === 'everyDays') return 1 / Math.max(1, goal);
  return 1;
}

/** 0 to 1, or null for an avoid goal or no goal. */
export function habitStrength(
  trackable: Pick<TrackableDefinition, 'goalType' | 'goalValue' | 'createdAt'> & Partial<Scheduled>,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  now: number = Date.now(),
): number | null {
  const type = trackable.goalType;
  const goal = trackable.goalValue;
  if (!type || type === 'avoid' || goal == null || goal <= 0) return null;
  const today = startOfDay(now);
  const times = entries.map((e) => e.timestamp).filter((t) => t <= now).sort((a, b) => a - b);
  const first = Math.min(startOfDay(trackable.createdAt ?? now), times.length ? startOfDay(times[0]) : today);
  // Loop's multiplier: the decay per day for this frequency.
  const keep = Math.pow(0.5, Math.sqrt(perDayFrequency(type, goal)) / 13);
  // How much each day counts: a share of a daily goal, or logged at all.
  let doneOn: (day: number) => number;
  if (type === 'dailyTotal' || type === 'perDay') {
    const valueOn = dailyValueOn(type, entries, fields);
    if (!valueOn) return null;
    doneOn = (d) => Math.min(1, valueOn(d) / goal);
  } else {
    const logged = new Set(times.map(startOfDay));
    doneOn = (d) => (logged.has(d) ? 1 : 0);
  }
  let score = 0;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const done = doneOn(d);
    if (offDayReason(trackable, d) && done === 0) continue;
    if (d === today && done < 1) continue;
    score = score * keep + done * (1 - keep);
  }
  return score;
}
