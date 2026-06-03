CREATE TABLE terminal_snapshots (
  terminal_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  serialized TEXT NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (terminal_id) REFERENCES workspace_panels(id) ON DELETE CASCADE,
  CHECK (sequence >= 0),
  CHECK (cols > 0),
  CHECK (rows > 0)
);
