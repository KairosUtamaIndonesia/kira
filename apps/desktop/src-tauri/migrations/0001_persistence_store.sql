CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE(folder_path)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT NULL,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE agent_threads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE workspace_panels (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  position_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (kind IN ('terminal'))
);

CREATE TABLE terminal_panel_state (
  panel_id TEXT PRIMARY KEY,
  working_directory TEXT NOT NULL,
  shell TEXT NULL,

  FOREIGN KEY (panel_id) REFERENCES workspace_panels(id) ON DELETE CASCADE
);

CREATE INDEX sessions_project_id_idx ON sessions(project_id);
CREATE INDEX agent_threads_session_id_idx ON agent_threads(session_id);
CREATE INDEX workspace_panels_session_id_idx ON workspace_panels(session_id);
