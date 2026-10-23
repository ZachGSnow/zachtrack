-- Fast lengths you save yourself (v1.8.0): JSON list of { id, label, targetHours }; NULL = none.
-- See src/lib/data/presets.ts.
ALTER TABLE settings ADD COLUMN customFastPresets TEXT;
