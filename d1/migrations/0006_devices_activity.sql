-- Devices and the shared sync activity log (v1.10.0). See functions/api/sync.ts.

-- Each device that syncs: its name (set on the device), the app version it
-- runs, and when it last synced. Not health data. Rows unseen for 90 days are
-- removed by the sync endpoint.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  appVersion TEXT,
  firstSeenAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL
);

-- One row per sync that changed something: which device, when, how many
-- records of each type (JSON), and up to 20 names ("Entry -- Water") but
-- never values. Kept 90 days.
CREATE TABLE syncEvents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId TEXT NOT NULL,
  at INTEGER NOT NULL,
  counts TEXT NOT NULL,
  details TEXT,
  rejectedCount INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX syncEvents_at ON syncEvents(at);

-- The device that last changed each record, so other devices can say where a
-- change came from. NULL for rows written before v1.10.0 or by an older app.
ALTER TABLE fasts ADD COLUMN updatedBy TEXT;
ALTER TABLE fieldDefinitions ADD COLUMN updatedBy TEXT;
ALTER TABLE trackableDefinitions ADD COLUMN updatedBy TEXT;
ALTER TABLE trackableEntries ADD COLUMN updatedBy TEXT;
ALTER TABLE settings ADD COLUMN updatedBy TEXT;
