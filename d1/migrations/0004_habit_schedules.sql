-- Habit schedules (v1.8.0): see src/lib/utils/trackableGoals.ts.
-- scheduleDays: JSON list of weekdays a daily goal applies (0 = Monday ... 6 = Sunday); NULL = every day.
-- skipDays: JSON list of skipped local dates ("YYYY-MM-DD"). pausedUntil: paused through this local day (ms).
-- goalType gains 'perDay' (entries per day); it is TEXT, so no change is needed for it.
ALTER TABLE trackableDefinitions ADD COLUMN scheduleDays TEXT;
ALTER TABLE trackableDefinitions ADD COLUMN skipDays TEXT;
ALTER TABLE trackableDefinitions ADD COLUMN pausedUntil INTEGER;
