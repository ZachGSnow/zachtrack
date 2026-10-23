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
