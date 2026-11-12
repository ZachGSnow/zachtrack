-- Tasks (v1.19.0): projects with sections, tasks with subtasks, and the
-- completion history of repeating tasks. See ARCHITECTURE.md 3.59 and the
-- TaskProject, Task and TaskCompletion types in src/lib/db.ts. Columns match
-- the TypeScript names 1:1, like the other synced tables.

CREATE TABLE taskProjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  notes TEXT,
  sections TEXT NOT NULL, -- JSON array of { id, name }, in display order
  archived INTEGER,
  sortOrder REAL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL,
  updatedBy TEXT
);
CREATE INDEX taskProjects_serverSeq ON taskProjects(serverSeq);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  projectId TEXT,         -- top-level tasks; NULL = no project
  sectionId TEXT,         -- a section id inside the project's sections
  parentId TEXT,          -- subtasks: the task they belong to
  notes TEXT,
  dueOn TEXT,             -- 'YYYY-MM-DD', local calendar day
  dueTime TEXT,           -- 'HH:MM', local time
  repeat TEXT,            -- JSON TaskRepeat, or NULL
  completedAt INTEGER,
  sortOrder REAL NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL,
  updatedBy TEXT
);
CREATE INDEX tasks_serverSeq ON tasks(serverSeq);

CREATE TABLE taskCompletions (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  completedAt INTEGER NOT NULL,
  dueOn TEXT,             -- the due date it was completed for
  nextDueOn TEXT,         -- the date the task moved on to
  subtaskIds TEXT,        -- JSON array of subtask ids reset by the move, or NULL
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  serverSeq INTEGER NOT NULL,
  updatedBy TEXT
);
CREATE INDEX taskCompletions_serverSeq ON taskCompletions(serverSeq);
