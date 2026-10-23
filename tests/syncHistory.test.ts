import { describe, expect, it } from 'vitest';
import { addToHistory, summarizeSync, type SyncHistoryEntry } from '../src/lib/utils/syncHistory';

const none = { fasts: 0, fieldDefinitions: 0, trackableDefinitions: 0, trackableEntries: 0, settings: false };

describe('summarizeSync', () => {
  it('says what was sent and what was received', () => {
    expect(summarizeSync({ trackableEntries: 2, deletes: 1 }, { ...none, fasts: 1 })).toBe('Sent 2 entries, 1 delete; received 1 fast');
    expect(summarizeSync({ settings: 1 }, none)).toBe('Sent settings');
    expect(summarizeSync(undefined, { ...none, trackableDefinitions: 1, settings: true })).toBe('Received 1 trackable, settings');
  });

  it('says No changes when nothing moved, including from a server without counts', () => {
    expect(summarizeSync({ fasts: 0, deletes: 0 }, none)).toBe('No changes');
    expect(summarizeSync(undefined, none)).toBe('No changes');
  });
});

describe('addToHistory', () => {
  const entry = (completedAt: number, extra: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry => ({
    completedAt,
    outcome: 'success',
    summary: 'No changes',
    rejectedCount: 0,
    ...extra,
  });

  it('keeps identical syncs in a row as one entry with a count and the first time', () => {
    let h: SyncHistoryEntry[] = [];
    h = addToHistory(h, entry(1), 5);
    h = addToHistory(h, entry(2), 5);
    h = addToHistory(h, entry(3), 5);
    expect(h).toEqual([entry(3, { repeat: 3, firstAt: 1 })]);
  });

  it('keeps syncs with details, or a different result, apart', () => {
    let h: SyncHistoryEntry[] = [entry(1)];
    h = addToHistory(h, entry(2, { summary: 'Sent 1 entry', sentDetails: ['Water -- 9:00 AM'] }), 5);
    h = addToHistory(h, entry(3, { summary: 'Sent 1 entry', sentDetails: ['Water -- 9:05 AM'] }), 5);
    h = addToHistory(h, entry(4, { outcome: 'offline', summary: 'Offline -- sync skipped' }), 5);
    expect(h.map((e) => e.completedAt)).toEqual([4, 3, 2, 1]);
  });

  it('drops the oldest past the limit', () => {
    let h: SyncHistoryEntry[] = [];
    for (let i = 1; i <= 4; i++) h = addToHistory(h, entry(i, { summary: `Sent ${i}`, sentDetails: ['x'] }), 3);
    expect(h.map((e) => e.completedAt)).toEqual([4, 3, 2]);
  });
});
