import type { FieldDefinition, TrackableDefinition } from '../db';
import { addDays, startOfDay } from './time';
import { computeFieldValuesByDay, type TimestampedValues } from './trackableStats';
import { DAILY_GOALS, goalField, offDayReason, WEEKDAY_NAMES, weekdayIndex } from './trackableGoals';

/**
 * Plain-language insights for a trackable's page. Deliberately modest: small
 * personal datasets are easy to over-read (the reason correlation hints were
 * held back in section 6), so every line carries its day counts, comparisons
 * need at least MIN_DAYS on each side, and they say "on days with", not why.
 */

export const MIN_DAYS = 5;

export interface Insight {
  /** Short heading, e.g. "Last 30 days". */
  label: string;
  text: string;
  /** A comparison's key, "<trackableId>|<otherId>|<0 same day, 1 day after>", for hiding it (settings.mutedInsights). */
  key?: string;
}

/**
 * Fasting as a factor (3.55): goal fasts as one more "trackable" to compare
 * against, so a page can say how weight or mood moves the day after a goal
 * fast. Its id is in comparison keys like any other.
 */
export const GOAL_FAST_ID = '__goal-fast';

export function goalFastFactor(
  fasts: readonly { startTime: number; endTime?: number; targetHours?: number }[],
  isGoal: (f: { startTime: number; endTime?: number; targetHours?: number }) => boolean,
): { trackable: { id: string; name: string }; entries: TimestampedValues[] } {
  return { trackable: { id: GOAL_FAST_ID, name: 'a goal fast' }, entries: fasts.filter((f) => f.endTime != null && isGoal(f)).map((f) => ({ timestamp: f.startTime })) };
}

/** The key a comparison is hidden by. */
export function insightKey(trackableId: string, otherId: string, daysAfter: number): string {
  return `${trackableId}|${otherId}|${daysAfter}`;
}

type Trackable = Pick<TrackableDefinition, 'id' | 'name' | 'goalType' | 'goalValue' | 'scheduleDays' | 'skipDays' | 'pausedUntil' | 'createdAt' | 'insightsHidden'> & Partial<Pick<TrackableDefinition, 'scheduleHistory'>>;

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** The days from `days - 1` days ago to today, oldest first, not before `since`. */
function recentDays(now: number, days: number, since: number): number[] {
  const today = startOfDay(now);
  const out: number[] = [];
  for (let d = addDays(today, -(days - 1)); d <= today; d = addDays(d, 1)) if (d >= since) out.push(d);
  return out;
}

/** The value insights compare: its first number or rating field per day, or whether it was logged at all. */
function dailyMetric(
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
): { name: string; byDay: Map<number, number> | null; describe: (v: number) => string } {
  const field = fields.find((f) => f.kind === 'rating') ?? fields.find((f) => f.kind === 'number');
  if (field) {
    const unit = field.kind === 'number' && field.unit ? ` ${field.unit}` : '';
    return { name: field.name, byDay: computeFieldValuesByDay(entries as TimestampedValues[], field), describe: (v) => `${nf.format(v)}${unit}` };
  }
  return { name: '', byDay: null, describe: (v) => `${Math.round(v * 100)}%` };
}

export function trackableInsights(
  trackable: Trackable,
  entries: readonly TimestampedValues[],
  fields: readonly FieldDefinition[],
  others: readonly { trackable: Pick<TrackableDefinition, 'id' | 'name' | 'insightsHidden'>; entries: readonly TimestampedValues[] }[],
  now: number = Date.now(),
  /** Comparisons hidden one by one (settings.mutedInsights). */
  muted: ReadonlySet<string> = new Set(),
): Insight[] {
  const insights: Insight[] = [];
  const firstDay = Math.min(startOfDay(trackable.createdAt), ...entries.map((e) => startOfDay(e.timestamp)));
  const loggedDays = new Set(entries.map((e) => startOfDay(e.timestamp)));

  // --- Consistency over the last 30 days -------------------------------------
  const last30 = recentDays(now, 30, firstDay);
  if (last30.length >= 7) {
    const type = trackable.goalType;
    if (type && DAILY_GOALS.includes(type) && trackable.goalValue) {
      const scheduled = last30.filter((d) => !offDayReason(trackable, d));
      const value =
        type === 'dailyTotal' && goalField(fields)
          ? (() => {
              const byDay = computeFieldValuesByDay(entries as TimestampedValues[], goalField(fields)!);
              return (d: number) => byDay.get(d) ?? 0;
            })()
          : (d: number) => entries.filter((e) => startOfDay(e.timestamp) === d).length;
      const met = scheduled.filter((d) => value(d) >= trackable.goalValue!).length;
      if (scheduled.length > 0) {
        insights.push({
          label: 'Last 30 days',
          text: `Goal met on ${met} of ${scheduled.length} days (${Math.round((met / scheduled.length) * 100)}%)`,
        });
      }
    } else {
      const logged = last30.filter((d) => loggedDays.has(d)).length;
      insights.push({ label: 'Last 30 days', text: `Logged on ${logged} of ${last30.length} days` });
    }
  }

  // --- Best and worst weekday over the last 12 weeks ---------------------------
  const last84 = recentDays(now, 84, firstDay);
  if (last84.length >= 28 && loggedDays.size >= MIN_DAYS) {
    const byWeekday = WEEKDAY_NAMES.map(() => ({ logged: 0, total: 0 }));
    for (const d of last84) {
      const w = byWeekday[weekdayIndex(d)];
      w.total += 1;
      if (loggedDays.has(d)) w.logged += 1;
    }
    const ranked = byWeekday
      .map((w, i) => ({ ...w, name: WEEKDAY_NAMES[i], share: w.total ? w.logged / w.total : 0 }))
      .filter((w) => w.total > 0)
      .sort((a, b) => b.share - a.share);
    const best = ranked[0];
    const worst = ranked.at(-1)!;
    if (best && best.share - worst.share >= 0.25) {
      insights.push({
        label: 'By weekday',
        text: `Most often on ${best.name}s (${best.logged} of ${best.total}), least on ${worst.name}s (${worst.logged} of ${worst.total})`,
      });
    }
  }

  // --- Compared with other trackables over the last 90 days ----------------------
  const last90 = recentDays(now, 90, firstDay);
  const metric = dailyMetric(entries, fields);
  const samples = metric.byDay
    ? last90.filter((d) => metric.byDay!.has(d)).map((d) => ({ day: d, v: metric.byDay!.get(d)! }))
    : last90.map((d) => ({ day: d, v: loggedDays.has(d) ? 1 : 0 }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const comparisons: { label: string; text: string; size: number; key: string }[] = [];
  // Two comparisons per other trackable: the same day, and the day after it
  // was logged (a late meal shows in the next morning's weight).
  const shifts: Array<{ label: string; days: number }> = [
    { label: 'On days with', days: 0 },
    { label: 'On days after', days: 1 },
  ];
  // A trackable kept out of comparisons has none of its own and appears in no one else's.
  for (const other of trackable.insightsHidden ? [] : others) {
    if (other.trackable.id === trackable.id || other.trackable.insightsHidden) continue;
    for (const shift of shifts) {
    const key = insightKey(trackable.id, other.trackable.id, shift.days);
    if (muted.has(key)) continue;
    const otherDays = new Set(other.entries.map((e) => addDays(startOfDay(e.timestamp), shift.days)));
    const withIt = samples.filter((s) => otherDays.has(s.day)).map((s) => s.v);
    const without = samples.filter((s) => !otherDays.has(s.day)).map((s) => s.v);
    if (withIt.length < MIN_DAYS || without.length < MIN_DAYS) continue;
    const a = mean(withIt);
    const b = mean(without);
    // Only differences worth a sentence. For a value: an effect size (Cohen's d, pooled
    // standard deviation) of at least 0.6, so a 0.3 lb wobble in a slowly moving weight
    // doesn't read as a pattern. For "logged or not": at least 20 points of share.
    const variance = (xs: number[], m: number) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
    const pooled = Math.sqrt(((withIt.length - 1) * variance(withIt, a) + (without.length - 1) * variance(without, b)) / (withIt.length + without.length - 2));
    const size = metric.byDay ? (pooled > 0 ? Math.abs(a - b) / pooled : a === b ? 0 : Infinity) : Math.abs(a - b);
    if (size < (metric.byDay ? 0.6 : 0.2)) continue;
    const subject = metric.byDay ? `${metric.name} averages` : 'Logged on';
    const tail = metric.byDay ? '' : ' of days';
    const joiner = shift.days ? 'after' : 'with';
    comparisons.push({
      label: shift.label,
      text: `${subject} ${metric.describe(a)}${tail} ${joiner} ${other.trackable.name} (${withIt.length} days), ${metric.describe(b)}${tail} ${shift.days ? 'otherwise' : 'without'} (${without.length})`,
      size,
      key,
    });
    }
  }
  for (const c of comparisons.sort((x, y) => y.size - x.size).slice(0, 3)) insights.push({ label: c.label, text: c.text, key: c.key });

  return insights;
}
