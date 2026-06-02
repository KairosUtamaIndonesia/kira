# 0001. Use a Rust-owned SQLite Persistence Store

## Status

Accepted

## Context

Kira needs durable storage for first-class project data, saved workspace sessions, opened panels, and future agent activity. The Persistence Store boundary should stay backend-owned so the React frontend cannot bypass domain behavior with direct SQL access.

## Decision

Kira will use SQLite as its app-owned Persistence Store, accessed only through the Rust backend. The backend will use `sqlx` for SQLite access and migrations. The frontend will read and mutate persisted data through Tauri commands, not by constructing SQL.

The initial durable model is:

- `Project`: the first-class Kira entity, pointing to a local folder or repository.
- `Session`: a saved Project context containing workspace state and Agent Threads.
- `Workspace Panel`: an opened workspace surface inside a Session.
- `Terminal Panel`: a Workspace Panel with restore metadata for recreating a terminal surface.
- `Agent Thread`: a durable conversational/workflow thread inside a Session.

Terminal process state is runtime-owned and is not persisted. Kira persists only enough Terminal Panel metadata to restore or recreate the panel.

## Rejected alternatives

- `tauri-plugin-sql`: rejected because it places SQL access too close to the frontend boundary and weakens backend ownership of persistence behavior.
- Diesel: rejected because Kira does not currently need a heavier ORM model.
- Raw `rusqlite`: rejected because `sqlx` fits async Tauri command flows and migration management better.

## Consequences

- Schema changes must be represented as migrations.
- Backend feature modules should own their persistence behavior and repository code.
- Tauri commands are the Persistence Store boundary for the frontend.
- Frontend code must not construct or execute SQL.
- Persistence errors should fail fast with explicit backend errors rather than hidden fallbacks.
