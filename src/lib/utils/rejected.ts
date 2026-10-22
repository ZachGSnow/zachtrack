import { formatDateTime } from './time';

/** One record the sync server refused, as it appears in the response's `rejected` list. */
export interface RejectedRecord {
  recordType: string;
  uuid: string;
  reason: string;
}

/** What this device knows locally, to name a rejected record in words instead of an id. */
export interface RejectedLookup {
  fasts: Map<string, { startTime: number }>;
  entries: Map<string, { trackableId: string; timestamp: number }>;
  trackables: Map<string, { name: string }>;
  fields: Map<string, { name: string }>;
}

/** Most rejected lines kept per sync in the history (the count is always exact). */
export const REJECTED_DETAILS_LIMIT = 10;

const shortId = (id: string) => (id ? id.slice(0, 8) : 'unknown');

function label(r: RejectedRecord, l: RejectedLookup): string {
  switch (r.recordType) {
    case 'fasts': {
      const fast = l.fasts.get(r.uuid);
      return fast ? `Fast started ${formatDateTime(fast.startTime)}` : `Fast ${shortId(r.uuid)}`;
    }
    case 'trackableEntries': {
      const entry = l.entries.get(r.uuid);
      if (!entry) return `Entry ${shortId(r.uuid)}`;
      const name = l.trackables.get(entry.trackableId)?.name ?? 'Unknown trackable';
      return `${name} entry, ${formatDateTime(entry.timestamp)}`;
    }
    case 'trackableDefinitions': {
      const t = l.trackables.get(r.uuid);
      return t ? `Trackable "${t.name}"` : `Trackable ${shortId(r.uuid)}`;
    }
    case 'fieldDefinitions': {
      const f = l.fields.get(r.uuid);
      return f ? `Field "${f.name}"` : `Field ${shortId(r.uuid)}`;
    }
    case 'settings':
      return 'Settings';
    case 'tombstones':
      return `Delete of ${shortId(r.uuid)}`;
    default:
      return `${r.recordType} ${shortId(r.uuid)}`;
  }
}

/** One readable line per rejected record, e.g. `Nutrition entry, Oct 20, 9:00 AM: Invalid record: ...`. */
export function describeRejected(rejected: RejectedRecord[], lookup: RejectedLookup): string[] {
  return rejected.map((r) => `${label(r, lookup)}: ${r.reason}`);
}
