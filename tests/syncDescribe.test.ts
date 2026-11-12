import { describe, expect, it } from 'vitest';
import type { FieldDefinition, RemoteSyncChanges, TrackableDefinition, TrackableEntry } from '../src/lib/db';
import { describeReceived, describeSent, findOverwritten, formatFieldValue, type LocalNames, type SentRecords } from '../src/lib/utils/syncDescribe';
import { formatDateTime } from '../src/lib/utils/time';

// The lines the sync history shows (ARCHITECTURE.md 3.10). Fictional data.

const at = new Date(2026, 5, 14, 9, 30).getTime();

const weight: FieldDefinition = { id: 'f-weight', name: 'Weight', kind: 'number', unit: 'lb', createdAt: at, updatedAt: at } as FieldDefinition;
const mood: FieldDefinition = { id: 'f-mood', name: 'Mood', kind: 'rating', ratingMax: 5, createdAt: at, updatedAt: at } as FieldDefinition;
const body: TrackableDefinition = { id: 't-body', name: 'Body', fieldIds: ['f-weight'], createdAt: at, updatedAt: at } as TrackableDefinition;

const names: LocalNames = {
  trackableById: new Map([[body.id, body]]),
  fieldById: new Map([
    [weight.id, weight],
    [mood.id, mood],
  ]),
  taskNameById: new Map([['task-1', 'Change the filter']]),
};

const entry = (over: Partial<TrackableEntry> & { deletedAt?: number; updatedBy?: string } = {}): TrackableEntry =>
  ({ id: 'e-1', trackableId: body.id, timestamp: at, values: { 'f-weight': 181.4 }, createdAt: at, updatedAt: at, ...over }) as TrackableEntry;

const empty = (): RemoteSyncChanges => ({ fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], taskProjects: [], tasks: [], taskCompletions: [], settings: null });
const nothingSent = (): SentRecords => ({ fasts: [], fieldDefinitions: [], trackableDefinitions: [], trackableEntries: [], taskProjects: [], tasks: [], taskCompletions: [], settings: null });
const laptop = (id: string | null | undefined) => (id === 'dev-laptop' ? 'Laptop' : '');

describe('formatFieldValue', () => {
  it('shows units, ratings out of their maximum and yes or no', () => {
    expect(formatFieldValue(weight, 181.4)).toBe('181.4 lb');
    expect(formatFieldValue(mood, 4)).toBe('4/5');
    expect(formatFieldValue({ ...weight, kind: 'boolean' } as FieldDefinition, true)).toBe('Yes');
    expect(formatFieldValue(undefined, 3)).toBe('3');
  });
});

describe('describeReceived', () => {
  it('names each record and the device it came from', () => {
    const changes = empty();
    changes.trackableEntries.push(entry({ updatedBy: 'dev-laptop' }), entry({ id: 'e-2', deletedAt: at }));
    changes.tasks!.push({ id: 'task-2', name: 'Book the dentist', dueOn: '2026-06-20', updatedAt: at } as never);
    changes.taskCompletions!.push({ id: 'c-1', taskId: 'task-1', updatedAt: at, updatedBy: 'dev-laptop' } as never);
    changes.settings = { updatedAt: at } as never;
    expect(describeReceived(changes, laptop, names)).toEqual([
      `Body (Weight: 181.4 lb) -- ${formatDateTime(at)} (Laptop)`,
      'Entry deleted -- Body',
      'Task -- Book the dentist, due 2026-06-20',
      'Completed -- Change the filter (Laptop)',
      'Settings updated',
    ]);
  });
});

describe('findOverwritten', () => {
  it("says which of this device's edits a newer one from elsewhere replaced", () => {
    const sent = nothingSent();
    sent.trackableEntries.push(entry({ updatedAt: at + 10 }));
    sent.tasks.push({ id: 'task-1', name: 'Change the filter', updatedAt: at + 10 } as never);
    const changes = empty();
    changes.trackableEntries.push(entry({ updatedAt: at + 20, updatedBy: 'dev-laptop' }));
    changes.tasks!.push({ id: 'task-1', name: 'Change the filter', updatedAt: at + 20, deletedAt: at + 20 } as never);
    expect(findOverwritten(sent, at, changes, laptop, names)).toEqual([
      `Your edit to an entry: Body (Weight: 181.4 lb) -- ${formatDateTime(at)} was replaced by Laptop's newer one`,
      'Your edit to the task Change the filter was replaced: another device deleted it',
    ]);
  });

  it('says nothing when this device had the newer edit, or on a first sync', () => {
    const sent = nothingSent();
    sent.trackableEntries.push(entry({ updatedAt: at + 30 }));
    const changes = empty();
    changes.trackableEntries.push(entry({ updatedAt: at + 20 }));
    expect(findOverwritten(sent, at, changes, laptop, names)).toEqual([]);
    expect(findOverwritten(sent, undefined, changes, laptop, names)).toEqual([]);
  });
});

describe('describeSent', () => {
  it('names what the server stored, and labels deletes from their tombstones', () => {
    const sent = nothingSent();
    sent.trackableEntries.push(entry());
    sent.taskCompletions.push({ id: 'c-1', taskId: 'task-1', updatedAt: at } as never);
    const lines = describeSent(
      [
        { recordType: 'trackableEntries', uuid: 'e-1' },
        { recordType: 'taskCompletions', uuid: 'c-1' },
        { recordType: 'tasks', uuid: 'task-9', deleted: true },
        { recordType: 'settings', uuid: 'settings' },
      ],
      sent,
      [{ recordType: 'tasks', uuid: 'task-9', deletedAt: at, label: 'Garden' } as never],
      names,
    );
    expect(lines).toEqual([`Body (Weight: 181.4 lb) -- ${formatDateTime(at)}`, 'Completed -- Change the filter', 'Task deleted -- Garden', 'Settings updated']);
  });
});
