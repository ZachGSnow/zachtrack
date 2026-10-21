import { DAY_MS, startOfDay } from './time';

export interface AgeBreakdown {
  years: number;
  months: number;
  days: number;
}

/** Calendar-accurate age breakdown (real years/months/days, not an approximation). */
export function computeAgeBreakdown(birthMs: number, nowMs: number = Date.now()): AgeBreakdown {
  const birth = new Date(birthMs);
  const now = new Date(nowMs);

  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();

  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); // days in the previous month
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    // Birthdate is in the future relative to `now` -- clamp rather than show negative age.
    return { years: 0, months: 0, days: 0 };
  }
  return { years, months, days };
}

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Formats a precise age, e.g. "2 years 5 months 3 days". Omits zero-value leading/middle units. */
export function formatPreciseAge(birthMs: number, nowMs: number = Date.now()): string {
  const { years, months, days } = computeAgeBreakdown(birthMs, nowMs);
  const parts: string[] = [];
  if (years > 0) parts.push(pluralize(years, 'year'));
  if (months > 0) parts.push(pluralize(months, 'month'));
  if (days > 0 || parts.length === 0) parts.push(pluralize(days, 'day'));
  return parts.join(' ');
}

/** The next occurrence (epoch ms, start-of-day) of this birth month/day on or after `fromMs`. */
export function nextBirthday(birthMs: number, fromMs: number = Date.now()): number {
  const birth = new Date(birthMs);
  const from = startOfDay(fromMs);
  const fromYear = new Date(from).getFullYear();
  const month = birth.getMonth();
  const day = birth.getDate();

  const candidateFor = (year: number): number => {
    const d = new Date(year, month, day);
    // Feb 29 in a non-leap year rolls over to Mar 1 -- clamp to Feb 28 instead.
    if (d.getMonth() !== month) return new Date(year, month + 1, 0).getTime();
    return d.getTime();
  };

  const thisYear = candidateFor(fromYear);
  return thisYear >= from ? thisYear : candidateFor(fromYear + 1);
}

/** Whole days from `fromMs` until the next birthday (0 = today). */
export function daysUntilNextBirthday(birthMs: number, fromMs: number = Date.now()): number {
  return Math.round((nextBirthday(birthMs, fromMs) - startOfDay(fromMs)) / DAY_MS);
}

/** The age they'll turn on their next upcoming birthday. */
export function ageTurningOn(birthMs: number, fromMs: number = Date.now()): number {
  return new Date(nextBirthday(birthMs, fromMs)).getFullYear() - new Date(birthMs).getFullYear();
}

/** Formats a birthday countdown, e.g. "Today! (party)", "Tomorrow", "in 12 days". */
export function formatBirthdayCountdown(daysUntil: number): string {
  if (daysUntil <= 0) return 'Today! \u{1F389}';
  if (daysUntil === 1) return 'Tomorrow';
  return `in ${daysUntil} days`;
}
