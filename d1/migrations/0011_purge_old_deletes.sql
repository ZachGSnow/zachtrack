-- Deleted rows are kept as markers so other devices learn of the delete
-- (ARCHITECTURE.md 3.6), and until v1.21.0 they were kept forever. Now they
-- go after 180 days (3.70). This row remembers how far that has reached, so
-- a device that was away longer than that, and so missed deletes the server
-- no longer has, is told to reload instead of pushing those records back.

CREATE TABLE purgeState (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- The highest serverSeq of a deleted row removed so far: a device whose
  -- cursor is below it may not have seen that delete.
  purgedThroughSeq INTEGER NOT NULL,
  -- When the last purge ran (it runs at most once a day, from a sync).
  lastPurgeAt INTEGER
);
INSERT INTO purgeState (id, purgedThroughSeq, lastPurgeAt) VALUES (1, 0, NULL);
