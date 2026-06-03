# @kira/agent-runtime

`@kira/agent-runtime` is Kira's Flue-backed desktop agent sidecar.

Rust/Tauri owns process supervision, frontend event delivery, and writes to the Kira SQLite Persistence Store. This package hosts Flue agents behind localhost HTTP/WebSocket routes and must not write Kira SQLite directly.

## Runtime model

Kira starts the sidecar with Bun and Flue's Node-target build output:

```bash
PORT=49321 \
KIRA_AGENT_RUNTIME_TOKEN=dev-secret \
KIRA_AGENT_PROJECT_PATH=C:/path/to/project \
bun dist/server.mjs
```

During development:

```bash
bun run dev
```

Build the sidecar:

```bash
bun run build
```

## Routes

`src/app.ts` is Kira's Hono wrapper around Flue routes.

- `GET /healthz` is Kira-owned and unauthenticated for local readiness checks.
- `/agents/*`, `/workflows/*`, and `/runs/*` require `Authorization: Bearer <KIRA_AGENT_RUNTIME_TOKEN>` or `?token=<KIRA_AGENT_RUNTIME_TOKEN>`.
- `app.route("/", flue())` mounts Flue's native routes.

## Agent Thread communication

Kira Agent Threads map to Flue agent instances:

```txt
Kira Agent Thread id = Flue agent instance id
Kira Agent Thread session = Flue session name, initially default
```

Connect to the coding agent over Flue's native WebSocket route:

```txt
ws://127.0.0.1:49321/agents/coding/<threadId>?token=dev-secret
```

Send Flue prompt frames:

```json
{
  "version": 1,
  "type": "prompt",
  "requestId": "prompt-1",
  "message": "Fix the failing tests",
  "session": "default"
}
```

The runtime responds with Flue WebSocket messages such as `ready`, `started`, `event`, `result`, and `error`.

## Agent

`src/agents/coding.ts` defines the first Kira coding agent. It uses Flue's local sandbox pointed at `KIRA_AGENT_PROJECT_PATH` so the agent can operate on the workspace selected by Kira.

The runtime registers Kira's current internal provider in `src/app.ts`:

- Provider id: `cx`
- Base URL: `https://router.kira.internal.kairos-it.com`
- Coding model: `cx/gpt-5.5`

Provider API, context-window, and max-token metadata are copied from Pi's built-in `openai/gpt-5.5` model so Flue compaction sees the same limits while requests route through Kira's internal provider:

- API: `openai-responses`
- Context window: `272,000`
- Max tokens: `128,000`

Set `KIRA_AGENT_PROVIDER_API_KEY` only if the internal router requires an API key.

## Persistence boundary

Durable persistence belongs to Rust/Tauri. This package currently relies on Flue's process-local session behavior. A future phase will map Flue events/session storage to Rust-owned SQLite writes without allowing this package to write SQLite directly.
