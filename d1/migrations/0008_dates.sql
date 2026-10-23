-- Dates trackables (v1.12.0): birthdays, anniversaries, holidays and
-- countdowns. See src/lib/utils/dates.ts.

-- What a dates trackable's entries are ('birthday', 'anniversary', 'holiday',
-- 'countdown'; NULL = birthday), and how many days ahead a date shows in
-- Needs attention (NULL = the kind's default).
ALTER TABLE trackableDefinitions ADD COLUMN dateKind TEXT;
ALTER TABLE trackableDefinitions ADD COLUMN dateLeadDays INTEGER;

-- How a date entry repeats: JSON { type: 'yearly' | 'once' | 'every' |
-- 'nthWeekday' | 'easter', ... }; NULL = the kind's default.
ALTER TABLE trackableEntries ADD COLUMN dateRepeat TEXT;
