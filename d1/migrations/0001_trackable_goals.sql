-- Optional goal per trackable (v1.6.0): see src/lib/utils/trackableGoals.ts.
-- goalType: 'dailyTotal' | 'perWeek' | 'everyDays' | 'avoid'; NULL = no goal.
-- goalValue: the goal's number (amount per day, days per week, or days between).
ALTER TABLE trackableDefinitions ADD COLUMN goalType TEXT;
ALTER TABLE trackableDefinitions ADD COLUMN goalValue REAL;
