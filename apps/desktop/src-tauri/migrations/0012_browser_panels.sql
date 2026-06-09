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
  CHECK (kind IN ('terminal', 'source_control_diff', 'file_editor', 'agent_thread', 'browser'))
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

CREATE TABLE browser_panel_state (
  panel_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,

  FOREIGN KEY (panel_id) REFERENCES workspace_panels(id) ON DELETE CASCADE
);

PRAGMA foreign_keys = ON;
