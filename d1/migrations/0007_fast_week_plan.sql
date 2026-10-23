-- A fasting plan per weekday (v1.11.0): JSON list of 7 entries, Monday first,
-- each null (use the daily defaults) or { presetId?, time?, rest? }; NULL =
-- no plan. See src/lib/utils/fastingSchedule.ts.
ALTER TABLE settings ADD COLUMN fastWeekPlan TEXT;
