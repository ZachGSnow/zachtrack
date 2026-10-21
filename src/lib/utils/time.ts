export const HOUR_MS = 60 * 60 * 1000;

/** Elapsed time in fractional hours between two epoch-ms timestamps. */
export function elapsedHours(startMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, (nowMs - startMs) / HOUR_MS);
}

/** Formats elapsed milliseconds as "HH:MM:SS" (hours can exceed 99). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Formats fractional hours as a short human string, e.g. "16h 24m". */
export function formatHoursShort(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Converts an epoch-ms timestamp to a value usable by <input type="datetime-local">. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses an <input type="datetime-local"> value (local time) back to epoch ms. */
export function fromDatetimeLocal(value: string): number {
  return new Date(value).getTime();
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar-day arithmetic that stays aligned to local midnight across DST
 * changes (unlike `ms + n * DAY_MS`, which drifts by an hour).
 */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Converts an epoch-ms timestamp to a value usable by <input type="date">. */
export function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses an <input type="date"> value (local time, midnight) back to epoch ms. */
export function fromDateInputValue(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}
