# @kira/agent-runtime

`@kira/agent-runtime` is the Bun/TypeScript process that hosts Pi SDK agent sessions for the Kira desktop app.

Rust/Tauri owns process supervision, frontend event delivery, and Kira SQLite Persistence Store writes. This package communicates over JSONL on stdio and must not write Kira SQLite directly.

## Current state

Implemented:

- JSONL stdio protocol boundary.
- Runtime protocol types in `src/protocol.ts`.
- Command validation in `src/validation.ts`.
- Exhaustive top-level dispatch in `src/dispatcher.ts`.
- Pi SDK runtime creation in `src/pi-runtime.ts`.
- One runtime process per Agent Thread.
- Pi `SessionManager.inMemory(projectPath)` so Pi does not write JSONL session files.
- Pi event forwarding as `pi:event`.
- Kira persistence bridge events:
  - `app:persist_session_entry` on Pi `message_end`.
  - `app:persistence_checkpoint` on Pi `agent_end`.
- Core Pi-compatible commands:
  - `prompt`
  - `steer`
  - `follow_up`
  - `abort`
  - `get_state`
  - `get_messages`
  - `get_commands`
- Real-provider prompt smoke test in `scripts/smoke-prompt.ts`.

## Runtime model

The initial runtime model is one OS process per Kira Agent Thread.

Tauri starts the process, sends an `app:initialize_thread` command, then sends Pi-compatible commands. The runtime emits JSONL records to stdout. Rust reads those records and decides what to forward to React or persist to SQLite.

## Protocol examples

Initialize a thread:

```json
{"id":"init","type":"app:initialize_thread","threadId":"thread-1","projectPath":"C:/path/to/project"}
```

Send a prompt:

```json
{"id":"prompt-1","type":"prompt","message":"Reply with exactly: KIRA_RUNTIME_OK"}
```

Get state:

```json
{"id":"state-1","type":"get_state"}
```

Shutdown:

```json
{"id":"shutdown","type":"app:shutdown"}
```

## Run locally

From this package:

```bash
bun src/main.ts
```

Then write one JSON object per line to stdin.

Run the real-provider smoke test:

```bash
bun run smoke:prompt
```

The smoke test starts the runtime, initializes a thread, sends a prompt, waits for the expected assistant output, verifies core command responses, observes persistence bridge events, and shuts the runtime down.

## Persistence boundary

Pi session persistence is intentionally in-memory in this process:

```ts
SessionManager.inMemory(projectPath)
```

This preserves Pi session behavior without creating Pi JSONL session files. Durable persistence belongs to Rust/Tauri. The runtime emits persistence-ready events that Rust can translate into SQLite transactions.

Current persistence events:

- `app:persist_session_entry`
  - emitted on Pi `message_end`
  - contains `threadId`, `sessionId`, and the message entry
- `app:persistence_checkpoint`
  - emitted on Pi `agent_end`
  - contains `threadId`, `sessionId`, reason, and current messages

## Remaining work

### 1. Forward Pi session events polish

- Confirm extension UI request behavior under the SDK runtime.
- Route extension UI requests through the current protocol.
- Preserve Pi-compatible event payloads where useful.

### 2. Persistence bridge expansion

- Emit persistence records for model changes.
- Emit persistence records for thinking-level changes.
- Emit persistence records for compaction entries.
- Emit persistence records for session info/name changes.
- Finalize the Rust-side SQLite schema these records map into.

### 3. More Pi-compatible commands

Still pending:

- Model commands:
  - `set_model`
  - `cycle_model`
  - `get_available_models`
- Thinking commands:
  - `set_thinking_level`
  - `cycle_thinking_level`
- Queue mode commands:
  - `set_steering_mode`
  - `set_follow_up_mode`
- Compaction/retry commands:
  - `compact`
  - `set_auto_compaction`
  - `set_auto_retry`
  - `abort_retry`
- Bash commands:
  - `bash`
  - `abort_bash`
- Session commands:
  - `new_session`
  - `switch_session`
  - `fork`
  - `clone`
  - `get_session_stats`
  - `export_html`
  - `get_fork_messages`
  - `get_last_assistant_text`
  - `set_session_name`

### 4. Extension UI response routing

- Implement inbound `extension_ui_response`.
- Inspect Pi RPC mode’s UI bridge and mirror the compatible parts.
- Keep request/response correlation stable for Rust and React.

### 5. Rust process supervision

Add `apps/desktop/src-tauri/src/agent_runtime.rs` or equivalent.

Needed behavior:

- Spawn runtime process.
- Write JSONL commands to stdin.
- Read stdout line-by-line.
- Parse and route runtime events.
- Terminate/restart cleanly.
- Surface structured runtime errors to frontend.

### 6. Tauri commands/events

- Start an Agent Thread runtime.
- Stop an Agent Thread runtime.
- Send an agent command.
- Stream runtime events to React.
- Associate all events with Agent Thread ids.

### 7. Persistence Store schema

Add Rust/sqlx migrations for:

- Agent Threads.
- Agent messages.
- Agent events/runs.
- Runtime checkpoints.
- Any replay/restoration records needed to restart a thread.

### 8. Sidecar build and bundling

Decide and implement:

- Development mode: `bun src/main.ts`.
- Production mode: likely `bun build --compile`.
- Tauri bundled external binary path.
- Platform-specific binary names and signing implications.

### 9. Tests

Add targeted tests for:

- JSONL parser/writer.
- Command validation.
- Dispatcher behavior.
- Pi command dispatch with fake/mocked runtime where possible.
- Runtime event forwarding.
- Persistence bridge event emission.

Keep `smoke:prompt` as a real-provider smoke test, not the primary automated unit test.

### 10. Developer documentation

Document:

- JSONL command and event contract.
- Runtime startup/shutdown lifecycle.
- Rust launch contract.
- Persistence event contract.
- How to debug against the local Pi source checkout.
