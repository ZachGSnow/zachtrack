import { describe, expect, it } from 'vitest';
import { describeRejected, type RejectedLookup } from '../src/lib/utils/rejected';
import { formatDateTime } from '../src/lib/utils/time';

const at = new Date(2026, 9, 20, 9, 0).getTime();
const lookup: RejectedLookup = {
  fasts: new Map([['fast-1', { startTime: at }]]),
  entries: new Map([['e1', { trackableId: 't-n', timestamp: at }], ['e-orphan', { trackableId: 't-gone', timestamp: at }]]),
  trackables: new Map([['t-n', { name: 'Nutrition' }]]),
  fields: new Map([['f-water', { name: 'Water' }]]),
};

describe('describeRejected', () => {
  // Reasons exactly as functions/api/sync.ts sends them.
  it('names local records in words and keeps the server reason', () => {
    expect(
      describeRejected(
        [
          { recordType: 'fasts', uuid: 'fast-1', reason: 'Another fast already starts on this day (conflicts with a fast synced from another device).' },
          { recordType: 'trackableEntries', uuid: 'e1', reason: 'Invalid record: values must be an object of numbers or booleans when set' },
          { recordType: 'trackableDefinitions', uuid: 't-n', reason: 'Invalid record: color must be a string' },
          { recordType: 'fieldDefinitions', uuid: 'f-water', reason: "Invalid record: kind must be 'number', 'rating' or 'boolean'" },
          { recordType: 'settings', uuid: 'app-settings', reason: 'Invalid record: updatedAt must be a number' },
        ],
        lookup,
      ),
    ).toEqual([
      `Fast started ${formatDateTime(at)}: Another fast already starts on this day (conflicts with a fast synced from another device).`,
      `Nutrition entry, ${formatDateTime(at)}: Invalid record: values must be an object of numbers or booleans when set`,
      'Trackable "Nutrition": Invalid record: color must be a string',
      "Field \"Water\": Invalid record: kind must be 'number', 'rating' or 'boolean'",
      'Settings: Invalid record: updatedAt must be a number',
    ]);
  });

  it('falls back to a short id for records this device does not have, and never throws', () => {
    expect(
      describeRejected(
        [
          { recordType: 'fasts', uuid: '0123456789abcdef', reason: 'r' },
          { recordType: 'trackableEntries', uuid: 'e-orphan', reason: 'r' },
          { recordType: 'tombstones', uuid: 'abcdef0123456', reason: 'r' },
          { recordType: 'fasts', uuid: '', reason: 'fasts must be a list' },
          { recordType: 'mystery', uuid: 'x', reason: 'r' },
        ],
        lookup,
      ),
    ).toEqual([
      'Fast 01234567: r',
      `Unknown trackable entry, ${formatDateTime(at)}: r`,
      'Delete of abcdef01: r',
      'Fast unknown: fasts must be a list',
      'mystery x: r',
    ]);
  });
});
