PRAGMA foreign_keys = OFF;

CREATE TABLE workspace_panels_next (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  position_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (kind IN ('terminal', 'source_control_diff'))
);

INSERT INTO workspace_panels_next (
  id,
  session_id,
  kind,
  title,
  position_index,
  created_at,
  updated_at
)
SELECT
  id,
  session_id,
  kind,
  title,
  position_index,
  created_at,
  updated_at
FROM workspace_panels;

DROP TABLE workspace_panels;
ALTER TABLE workspace_panels_next RENAME TO workspace_panels;
CREATE INDEX workspace_panels_session_id_idx ON workspace_panels(session_id);

CREATE TABLE source_control_diff_panel_state (
  panel_id TEXT PRIMARY KEY,
  folder_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  old_path TEXT NULL,
  source TEXT NOT NULL,

  FOREIGN KEY (panel_id) REFERENCES workspace_panels(id) ON DELETE CASCADE,
  CHECK (source IN ('staged', 'unstaged', 'untracked'))
);

PRAGMA foreign_keys = ON;
