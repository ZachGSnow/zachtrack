-- Daily fasting schedule (v1.6.0): the planned start time, "HH:MM" local time.
-- NULL = no schedule. See src/lib/utils/fastingSchedule.ts.
ALTER TABLE settings ADD COLUMN fastScheduleTime TEXT;
