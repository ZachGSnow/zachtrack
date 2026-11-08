import type { TrackableDefinition, TrackableEntry } from '../db';
import { addDays, startOfDay } from './time';
import { dateKindOf, easterSunday, nextOccurrence, repeatOf } from './dates';

// Dates as an iCalendar file (RFC 5545) for Google Calendar, Outlook or any
// calendar app (3.49). All-day events; a date that repeats becomes one event
// with a repeat rule, so the calendar keeps it going. Easter-based dates have
// no RRULE form and are written out for EASTER_YEARS years. Built on the
// device and downloaded; nothing is uploaded. Pure; tests/ics.test.ts.

/** How many years of Easter-based dates the file lists. */
export const EASTER_YEARS = 10;

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const pad = (n: number) => String(n).padStart(2, '0');
const icsDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};
const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Text values escape backslashes, semicolons, commas and newlines. */
export function escapeText(text: string): string {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

type IcsTrackable = Pick<TrackableDefinition, 'id' | 'name' | 'displayMode' | 'dateKind' | 'archived'>;
type IcsEntry = Pick<TrackableEntry, 'id' | 'trackableId' | 'timestamp' | 'note' | 'dateRepeat'>;

/** The event's title: "Alex's birthday", "Us anniversary", or the date's name. */
function summaryFor(kind: string, name: string): string {
  if (kind === 'birthday') return `${name}${name.endsWith('s') ? "'" : "'s"} birthday`;
  if (kind === 'anniversary') return `${name} anniversary`;
  return name;
}

export function datesToIcs(trackables: readonly IcsTrackable[], entries: readonly IcsEntry[], now: number): string {
  const byId = new Map(trackables.filter((t) => t.displayMode === 'ages' && !t.archived).map((t) => [t.id, t] as const));
  const stamp = icsStamp(now);
  const events: string[][] = [];
  const event = (uid: string, start: number, summary: string, category: string, rrule?: string) => {
    const lines = [
      'BEGIN:VEVENT',
      `UID:${uid}@zachtrack`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(startOfDay(start), 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `CATEGORIES:${escapeText(category)}`,
      'TRANSP:TRANSPARENT',
    ];
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push('END:VEVENT');
    events.push(lines);
  };

  for (const e of entries) {
    const t = byId.get(e.trackableId);
    if (!t) continue;
    const kind = dateKindOf(t);
    const repeat = repeatOf(e, kind);
    const name = e.note?.trim() || 'Untitled';
    const summary = summaryFor(kind, name);
    switch (repeat.type) {
      case 'yearly':
        event(e.id, e.timestamp, summary, t.name, 'FREQ=YEARLY');
        break;
      case 'once':
        event(e.id, e.timestamp, summary, t.name);
        break;
      case 'every':
        event(e.id, e.timestamp, summary, t.name, `FREQ=${repeat.unit === 'years' ? 'YEARLY' : 'MONTHLY'};INTERVAL=${repeat.count}`);
        break;
      case 'nthWeekday':
        // From the next time it falls, so the start date is a real occurrence.
        event(e.id, nextOccurrence(e, kind, now).at, summary, t.name, `FREQ=YEARLY;BYMONTH=${repeat.month + 1};BYDAY=${repeat.nth}${WEEKDAYS[repeat.weekday]}`);
        break;
      case 'easter': {
        const first = new Date(now).getFullYear();
        for (let y = first; y < first + EASTER_YEARS; y++) {
          event(`${e.id}-${y}`, addDays(easterSunday(y), repeat.offsetDays ?? 0), summary, t.name);
        }
        break;
      }
    }
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZachTrack//Dates//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:ZachTrack dates',
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
