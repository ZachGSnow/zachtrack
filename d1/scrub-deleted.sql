-- One-time cleanup: clear the content of rows deleted before the sync
-- endpoint started doing this itself on every delete (see TOMBSTONE_TABLES
-- in functions/api/sync.ts). Safe to run more than once. Take an export first:
--   wrangler d1 export zachtrack-db --remote --output=<file outside the repo>
-- then:
--   wrangler d1 execute zachtrack-db --remote --file=./d1/scrub-deleted.sql

UPDATE fasts SET note = NULL, tags = NULL, moodRating = NULL, energyRating = NULL, hungerRating = NULL
WHERE deletedAt IS NOT NULL;

UPDATE trackableEntries SET note = NULL, tags = NULL, fieldValues = NULL
WHERE deletedAt IS NOT NULL;
