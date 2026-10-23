import { describe, expect, it } from 'vitest';
import { buildCsv, csvFileName } from '../src/lib/dataFile';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('CSV export', () => {
  it('writes one row per value, fasts included, sorted by time, quoted where needed', () => {
    const csv = buildCsv({
      fasts: [
        { uuid: 'f1', startTime: at(20, 20), startDay: at(20, 0), endTime: at(21, 12), method: 'preset', presetLabel: '16:8', moodRating: 4, createdAt: 1, updatedAt: 1 },
        { uuid: 'f2', startTime: at(22, 20), startDay: at(22, 0), method: 'preset', createdAt: 1, updatedAt: 1 },
      ],
      fieldDefinitions: [
        { id: 'w', name: 'Water', kind: 'number', unit: 'oz', createdAt: 1, updatedAt: 1 },
        { id: 's', name: 'Supplements', kind: 'boolean', createdAt: 1, updatedAt: 1 },
      ],
      trackableDefinitions: [
        { id: 'n', name: 'Nutrition', icon: 'x', color: '#000', fieldIds: ['w', 's'], createdAt: 1, updatedAt: 1 },
        { id: 'm', name: 'Male Health', icon: 'x', color: '#000', fieldIds: [], createdAt: 1, updatedAt: 1 },
      ],
      trackableEntries: [
        { id: 'e1', trackableId: 'n', timestamp: at(21, 9, 5), values: { w: 16, s: true }, note: 'after a run, "cold"', tags: ['gym', 'am'], createdAt: 1, updatedAt: 1 },
        { id: 'e2', trackableId: 'm', timestamp: at(20, 8), createdAt: 1, updatedAt: 1 },
      ],
      settings: null,
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Date,Time,Trackable,Field,Value,Unit,Note,Tags',
      '2026-10-20,08:00,Male Health,,,,,',
      '2026-10-20,20:00,Fast (16:8),Hours,16,h,,',
      '2026-10-20,20:00,Fast (16:8),Mood,4,1-5,,',
      '2026-10-21,09:05,Nutrition,Water,16,oz,"after a run, ""cold""",gym; am',
      '2026-10-21,09:05,Nutrition,Supplements,Yes,,"after a run, ""cold""",gym; am',
      '',
    ]);
    expect(csvFileName(new Date(2026, 9, 23))).toBe('zachtrack-export-2026-10-23.csv');
  });
});
