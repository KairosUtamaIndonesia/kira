CREATE TABLE agent_thread_context_usage (
  agent_thread_id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL,
  used_tokens INTEGER NOT NULL,
  context_window INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  input_cost REAL NOT NULL,
  output_cost REAL NOT NULL,
  cache_read_cost REAL NOT NULL,
  cache_write_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (agent_thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE
);
