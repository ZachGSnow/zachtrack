-- Insight controls and notes on dates (v1.17.0). See ARCHITECTURE.md 3.50.

-- A trackable kept out of the "on days with" comparisons, its own and the
-- others': 1 = kept out; NULL = included.
ALTER TABLE trackableDefinitions ADD COLUMN insightsHidden INTEGER;

-- Comparisons hidden one by one: JSON list of keys
-- "<trackableId>|<otherTrackableId>|<0 same day, 1 day after>"; NULL = none.
ALTER TABLE settings ADD COLUMN mutedInsights TEXT;

-- Free-text notes on a date entry (gift ideas, sizes); the entry's `note`
-- stays its name. Cleared on the server when the entry is deleted.
ALTER TABLE trackableEntries ADD COLUMN details TEXT;
