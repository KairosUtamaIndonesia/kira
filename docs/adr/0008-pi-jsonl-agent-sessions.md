# ADR 0008: Pi-native JSONL Agent Thread sessions

## Status

Accepted

## Context

Kira's first Pi runtime integration adapted Pi events into the older Flue-shaped desktop transcript table and also stored Pi session state as an opaque blob through the Rust SQLite persistence bridge. That preserved the existing process boundary, but it forced Pi's message/turn/tree model through Kira request-id grouping. Streaming UI then had to reconstruct Pi message identity from raw event rows, which caused duplicated assistant bubbles and delayed rendering.

Pi already provides filesystem-backed JSONL session management through `SessionManager`. The SDK documentation describes `AgentSession` as the owner of message history, model state, compaction, event streaming, and in-place tree navigation, with runtime-level APIs for new/resume/fork/import.

## Decision

Desktop Agent Threads use Pi's native JSONL session files for Pi transcript and tree persistence.

Kira stores those files under the app data directory, next to `kira.sqlite3`:

```txt
<AppData>/com.kairos.kira/
  kira.sqlite3
  agent-pi-sessions/
    <agent-thread-id>/
      session.jsonl
```

SQLite remains the persistence store for Kira-owned metadata: projects, sessions, panels, Agent Thread records, settings, and cached organization model configuration. It no longer stores Pi transcript rows or opaque Pi session blobs.

## Consequences

- Pi owns Pi session identity, message history, tree navigation, branching, and JSONL compatibility.
- Kira's frontend should render live Pi events and hydrate transcript state from the Pi session, not replay Flue-style `request_id` event rows.
- The obsolete SQLite tables `agent_thread_message_records` and `flue_agent_session_state` are dropped for new migrations.
- The desktop process boundary remains Rust/Tauri-owned: Rust resolves the app data directory and passes the Pi session root to the Node runtime at spawn time.
- Existing Flue transcript rows are not migrated. Pi runtime cutover creates/uses Pi JSONL sessions going forward.
