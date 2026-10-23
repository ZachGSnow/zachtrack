-- Trackables list tidy-up (v1.6.0): pin to top, archive, and a manual order.
-- pinned / archived: 0 or 1, NULL = no. sortOrder: position in "My order", NULL = after the ordered ones.
ALTER TABLE trackableDefinitions ADD COLUMN pinned INTEGER;
ALTER TABLE trackableDefinitions ADD COLUMN archived INTEGER;
ALTER TABLE trackableDefinitions ADD COLUMN sortOrder REAL;
