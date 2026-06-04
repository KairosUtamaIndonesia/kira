CREATE TABLE agent_thread_message_records (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,

  FOREIGN KEY (thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE,
  CHECK (kind IN ('prompt', 'event', 'result'))
);

CREATE INDEX agent_thread_message_records_thread_id_created_at_idx ON agent_thread_message_records(thread_id, created_at);
