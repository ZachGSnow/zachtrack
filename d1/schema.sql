-- ZachTrack D1 schema
-- Column names intentionally match the TS interfaces in src/lib/db.ts
-- (camelCase) 1:1, except trackableEntries.values -> fieldValues (SQLite
-- reserves the bare word VALUES; the sync API still speaks `values` on the
-- wire and maps it to this column name).
--
-- Every syncable table carries:
--   - a stable uuid/id primary key (never Dexie's local auto-increment id)
--   - updatedAt (client clock, ms) for last-write-wins conflict resolution
--   - deletedAt (soft-delete tombstone; NULL = not deleted)
--   - serverSeq (server-assigned monotonic ordering; the sync cursor)

CREATE TABLE fasts (
  uuid TEXT PRIMARY KEY,
  startTime INTEGER NOT NULL,
  startDay INTEGER NOT NULL,
  endTime INTEGER,
  method TEXT NOT NULL,
  presetId TEXT,
  presetLabel TEXT,
  targetHours REAL,
  moodRating INTEGER,
  energyRating INTEGER,
  hungerRating INTEGER,
  tags TEXT,             -- JSON array of strings, or NULL
  note TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL
);

-- Enforces the one-fast-per-calendar-day rule server-side too, but only
-- among non-deleted rows so a soft-deleted fast frees up its day.
CREATE UNIQUE INDEX fasts_startDay_active ON fasts(startDay) WHERE deletedAt IS NULL;
CREATE INDEX fasts_serverSeq ON fasts(serverSeq);

CREATE TABLE fieldDefinitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT,
  ratingMin INTEGER,
  ratingMax INTEGER,
  aggregation TEXT, -- 'sum' | 'average' | 'last'; NULL behaves as 'last'
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL
);
CREATE INDEX fieldDefinitions_serverSeq ON fieldDefinitions(serverSeq);

CREATE TABLE trackableDefinitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  fieldIds TEXT NOT NULL, -- JSON array of FieldDefinition ids, ordered
  displayMode TEXT, -- 'occurrences' (default/NULL) | 'ages'
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL
);
CREATE INDEX trackableDefinitions_serverSeq ON trackableDefinitions(serverSeq);

CREATE TABLE trackableEntries (
  id TEXT PRIMARY KEY,
  trackableId TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  note TEXT,
  tags TEXT,              -- JSON array of strings, or NULL
  fieldValues TEXT,       -- JSON object (fieldId -> number|boolean), or NULL; wire name is `values`
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL
);
CREATE INDEX trackableEntries_serverSeq ON trackableEntries(serverSeq);
CREATE INDEX trackableEntries_trackableId ON trackableEntries(trackableId);

-- Singleton row, id fixed to 'app-settings'; never soft-deleted.
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  defaultPresetId TEXT,
  notificationsEnabled INTEGER,
  heightInches REAL,
  goalWeightLb REAL,
  updatedAt INTEGER NOT NULL,
  serverSeq INTEGER NOT NULL
);

-- Single-row global counter. Every upsert across every table above
-- increments this in the same transaction and stamps its own new value
-- into serverSeq, giving a clock-skew-proof, strictly-ordered sync cursor.
CREATE TABLE syncSeq (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT INTO syncSeq (id, value) VALUES (1, 0);
