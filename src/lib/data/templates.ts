import type { DateKind, FieldAggregation, FieldKind, TrackableGoalType } from '../db';

/**
 * Starting points offered when creating a trackable: a name, icon, colour,
 * fields and a goal that usually fit. Fields are matched to existing ones by
 * name and kind (so a template reuses your Weight field), else created.
 * Everything stays editable afterwards.
 */
export interface TrackableTemplate {
  name: string;
  icon: string;
  color: string;
  fields: { name: string; kind: FieldKind; unit?: string; aggregation?: FieldAggregation; ratingMax?: number }[];
  goalType?: TrackableGoalType;
  goalValue?: number;
  /** A dates trackable of this kind (utils/dates.ts) instead of fields and a goal. */
  dateKind?: DateKind;
  /** Also add the US holiday pack's entries when it's saved (data/holidays.ts). */
  holidayPack?: boolean;
}

export const TEMPLATES: TrackableTemplate[] = [
  { name: 'Water', icon: '\u{1F4A7}', color: '#38bdf8', fields: [{ name: 'Water', kind: 'number', unit: 'oz', aggregation: 'sum' }], goalType: 'dailyTotal', goalValue: 64 },
  { name: 'Workout', icon: '\u{1F3CB}\u{FE0F}', color: '#22d3ee', fields: [], goalType: 'perWeek', goalValue: 3 },
  { name: 'Weigh-in', icon: '\u{2696}\u{FE0F}', color: '#a855f7', fields: [{ name: 'Weight', kind: 'number', unit: 'lb', aggregation: 'last' }], goalType: 'everyDays', goalValue: 7 },
  { name: 'Meditation', icon: '\u{1F9D8}', color: '#818cf8', fields: [{ name: 'Duration', kind: 'number', unit: 'min', aggregation: 'sum' }], goalType: 'dailyTotal', goalValue: 10 },
  { name: 'Reading', icon: '\u{1F4D6}', color: '#eab308', fields: [{ name: 'Pages', kind: 'number', unit: 'pages', aggregation: 'sum' }], goalType: 'dailyTotal', goalValue: 20 },
  { name: 'Vitamins', icon: '\u{1F48A}', color: '#10b981', fields: [], goalType: 'perDay', goalValue: 1 },
  { name: 'Journal', icon: '\u{1F4D3}', color: '#f97316', fields: [], goalType: 'perDay', goalValue: 1 },
  { name: 'Mood', icon: '\u{1F642}', color: '#ec4899', fields: [{ name: 'Mood', kind: 'rating', ratingMax: 5, aggregation: 'average' }], goalType: 'everyDays', goalValue: 1 },
  { name: 'No alcohol', icon: '\u{1F6AB}', color: '#ef4444', fields: [], goalType: 'avoid' },
  { name: 'Birthdays', icon: '\u{1F382}', color: '#ec4899', fields: [], dateKind: 'birthday' },
  { name: 'Anniversaries', icon: '\u{1F48D}', color: '#f43f5e', fields: [], dateKind: 'anniversary' },
  { name: 'US holidays', icon: '\u{1F389}', color: '#f59e0b', fields: [], dateKind: 'holiday', holidayPack: true },
  { name: 'Countdowns', icon: '\u{23F3}', color: '#14b8a6', fields: [], dateKind: 'countdown' },
];
