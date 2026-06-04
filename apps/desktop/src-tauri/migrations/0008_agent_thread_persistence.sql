CREATE TABLE workspace_panels_next (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  position_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (kind IN ('terminal', 'source_control_diff', 'file_editor', 'agent_thread'))
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

CREATE TABLE agent_thread_panel_state (
  panel_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,

  FOREIGN KEY (panel_id) REFERENCES workspace_panels(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE
);

CREATE TABLE flue_agent_session_state (
  storage_key TEXT PRIMARY KEY,
  agent_thread_id TEXT NOT NULL,
  session_data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (agent_thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE
);

CREATE INDEX flue_agent_session_state_agent_thread_id_idx ON flue_agent_session_state(agent_thread_id);
