# @kira/agent-runtime

`@kira/agent-runtime` is the headless agent sidecar for the Kira desktop app.

Rust/Tauri owns process supervision, frontend event delivery, and Kira SQLite Persistence Store writes. This package hosts the agent runtime behind a localhost HTTP/WebSocket boundary and must not write Kira SQLite directly.

## Current direction

The runtime is being rebuilt as a Flue-native host process. The current implementation is a clean HTTP/WebSocket skeleton that preserves Kira's ownership boundaries while removing the previous Pi-compatible command surface.

Implemented:

- Localhost HTTP server entrypoint.
- Token-protected runtime API.
- `GET /healthz` readiness endpoint.
- WebSocket event stream at `GET /events?token=...`.
- In-memory Agent Thread registry.
- Thread creation and lookup endpoints.
- Prompt placeholder endpoint that emits Flue-shaped events.
- Kira persistence bridge event shape for Rust-owned SQLite writes.

Not implemented yet:

- Real Flue harness/session creation.
- Real prompt execution and model/provider configuration.
- Tool, run, abort, and dispatch routing.
- Rust/Tauri process supervision.
- SQLite persistence schema and event consumers.

## Runtime model

The intended desktop model is one sidecar process supervised by Rust/Tauri. Rust starts the process with a random localhost port and random per-process token:

```bash
KIRA_AGENT_RUNTIME_PORT=49321 \
KIRA_AGENT_RUNTIME_TOKEN=dev-secret \
bun src/main.ts
```

The server binds to `127.0.0.1` only.

## HTTP API

### Health

```http
GET /healthz
```

```json
{
  "status": "ready",
  "packageName": "@kira/agent-runtime",
  "protocolVersion": 2
}
```

### Create Agent Thread

```http
POST /threads
Authorization: Bearer dev-secret
Content-Type: application/json
```

```json
{
  "threadId": "thread-1",
  "projectPath": "C:/path/to/project",
  "agent": "coding",
  "displayName": "Kira"
}
```

### Get Agent Thread

```http
GET /threads/thread-1
Authorization: Bearer dev-secret
```

### Prompt Agent Thread

```http
POST /threads/thread-1/prompt
Authorization: Bearer dev-secret
Content-Type: application/json
```

```json
{
  "message": "Fix the failing tests"
}
```

This currently queues a placeholder event. It will become the Flue session prompt path.

## Event stream

Connect to:

```txt
ws://127.0.0.1:49321/events?token=dev-secret
```

Events are JSON messages. Flue runtime activity is forwarded as `flue:event`; Kira persistence bridge records use `app:*` events.

## Persistence boundary

Durable persistence belongs to Rust/Tauri. This package emits persistence-ready events, and Rust translates them into SQLite transactions.

Current persistence event:

```json
{
  "type": "app:persist_session_entry",
  "threadId": "thread-1",
  "sessionId": "session_thread-1",
  "entry": {
    "kind": "flue_event",
    "event": {
      "type": "prompt_queued"
    }
  }
}
```
