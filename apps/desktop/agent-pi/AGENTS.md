# Agent Pi (embedded agent runtime)

`apps/desktop/agent-pi/` is an embedded agent runtime built on the Pi SDK (`@earendil-works/pi-*`). It runs as a subprocess managed by the Tauri backend's `agent_runtime` Rust module.

## Purpose

The agent Pi provides:

- **Agent thread execution**: full agent runtime with tool use, skills, and model interaction
- **Commit message generation**: AI-powered git commit message suggestions
- **Thread title generation**: auto-generated titles for agent conversations
- **Context management**: context window tracking and thread preparation
- **Memory system**: durable agent memory with consolidation, search, and FTS
- **Guardrails**: safety policies for command execution, file access, and prompts
- **Tool UI bridge**: WebSocket transport for real-time tool UI updates to the desktop frontend

## Architecture

```
┌──────────────────────────────────────────┐
│  Hono HTTP Server (src/server.ts)        │
│  Routes defined in src/kira/app-routes.ts│
├──────────────────────────────────────────┤
│  Kira domain layer (src/kira/)           │
│  agent-session-host, context, auth, etc. │
├──────────────────────────────────────────┤
│  Pi SDK integration                      │
│  pi-agent-core, pi-ai, pi-coding-agent   │
├──────────────────────────────────────────┤
│  Extensions                              │
│  guardrails/, memory/                    │
├──────────────────────────────────────────┤
│  Persistence                             │
│  SQLite via better-sqlite3 (memory store)│
└──────────────────────────────────────────┘
```

## Source structure

```
src/
├── server.ts                     # Entry point — Hono HTTP server + WS upgrade
├── app.ts                        # App bootstrap and initialization
├── protocol/
│   └── index.ts                  # Desktop ↔ agent-pi wire protocol (shared via @kira/agent-pi/protocol)
└── kira/
    ├── agent-session-host.ts     # Pi session host for agent threads
    ├── agent-thread-context.ts   # Thread context preparation
    ├── app-routes.ts             # HTTP route definitions
    ├── auth.ts                   # Authentication for desktop ↔ agent API
    ├── commit-message-generation.ts  # AI commit message generation
    ├── context-usage.ts          # Context window tracking
    ├── env.ts                    # Environment configuration
    ├── model-catalog.ts          # AI model catalog from org config
    ├── pi-model.ts               # Pi model provider integration
    ├── session-serialization.ts  # Session snapshot + tree serialization for the desktop
    ├── skill-expansion.ts        # Skill SKILL.md loading and expansion
    ├── title-generation.ts       # Agent thread title generation
    ├── tool-ui-broker.ts         # Tool UI state bridge (WebSocket)
    ├── ws-transport.ts           # WebSocket transport: typed commands + event forwarding
    └── tools/
        └── ask-user-tool.ts      # Tool that asks the user questions
    └── extensions/
        ├── guardrails/           # Safety policies
        │   ├── index.ts
        │   ├── config.ts
        │   ├── defaults.ts
        │   ├── grants.ts
        │   ├── patterns.ts
        │   ├── types.ts
        │   └── handlers/
        │       ├── command-gate.ts
        │       ├── file-policies.ts
        │       └── prompt.ts
        └── memory/               # Durable agent memory
            ├── index.ts
            ├── config.ts
            ├── constants.ts
            ├── paths.ts
            ├── project.ts
            ├── prompt-context.ts
            ├── run-memory-prompt.ts
            ├── tool-def-to-agent-tool.ts
            ├── types.ts
            ├── handlers/         # Memory lifecycle handlers
            │   ├── auto-consolidate.ts
            │   ├── background-review.ts
            │   ├── correction-detector.ts
            │   ├── index-sessions.ts
            │   ├── insights.ts
            │   ├── interview.ts
            │   ├── learn-memory.ts
            │   ├── message-parts.ts
            │   ├── preview-context.ts
            │   ├── session-flush.ts
            │   ├── skills-command.ts
            │   ├── switch-project.ts
            │   └── sync-markdown-memories.ts
            ├── store/            # Memory persistence layer
            │   ├── content-scanner.ts
            │   ├── db.ts
            │   ├── fts-query.ts
            │   ├── memory-lookup.ts
            │   ├── memory-store.ts
            │   ├── schema.ts
            │   ├── session-anchor-search.ts
            │   ├── session-indexer.ts
            │   ├── session-parser.ts
            │   ├── session-search.ts
            │   ├── skill-store.ts
            │   ├── skill-utils.ts
            │   └── sqlite-memory-store.ts
            └── tools/
                ├── memory-search-tool.ts
                ├── memory-tool.ts
                ├── session-search-tool.ts
                └── skill-tool.ts
```

## Communication with the desktop

The Tauri backend's `agent_runtime` Rust module manages the agent Pi subprocess:

1. **Startup**: `agent_runtime::start_agent_runtime` spawns the agent Pi server as a child process
2. **HTTP API**: The Tauri backend calls agent Pi endpoints (commit messages, thread titles)
3. **WebSocket**: `/agents/:threadId/ws` bridges each Agent Thread's Pi `AgentSession` to the desktop frontend
4. **Auth**: Requests between the desktop and agent Pi use `auth.ts` for authentication (shared secret)

### Wire protocol (`src/protocol/index.ts`)

The desktop frontend consumes this module as `@kira/agent-pi/protocol` (workspace
dependency, type-only plus the pure `messageDisplayId` helper). It defines every
frame crossing the socket:

- **Commands** (client → server): `AgentSocketCommand` — `prompt`, `steer`, `abort`,
  `clear_queue`, `tool_ui_response`, `navigate_tree`, `switch_model`, `compact`.
  Every command carries an `id`; the server acks with a `response` frame.
- **Events** (server → client): Pi `AgentSessionEvent`s are forwarded verbatim.
- **Server pushes**: `session_snapshot` on socket attach and after `navigate_tree`;
  `context_usage` and `tree_updated` after every settled run and compaction;
  `error` when an accepted run fails; `tool_ui_request` for interactive tools.

Protocol changes MUST be made in `src/protocol/index.ts` so both ends stay in
sync at compile time. `messageDisplayId` is the shared message-identity
derivation — the session-tree serializer and the desktop transcript both rely
on it; never fork that logic.

## HTTP routes

Defined in `src/kira/app-routes.ts`, mounted under `/app`:

| Method | Route                          | Purpose                               |
| ------ | ------------------------------ | ------------------------------------- |
| GET    | `/healthz`                     | Health check (root, not under `/app`) |
| GET    | `/app/skills`                  | List Bundled Skills                   |
| GET    | `/app/skills/:name/body`       | Read one Bundled Skill body           |
| POST   | `/app/agent-threads`           | Register an Agent Thread context      |
| DELETE | `/app/agent-threads/:id`       | Release a cached Agent Thread session |
| POST   | `/app/agent-thread-title`      | Generate thread title                 |
| POST   | `/app/generate-commit-message` | Generate commit message from git diff |
| WS     | `/agents/:threadId/ws`         | Agent Thread session socket           |

## Common commands

```bash
bun run dev              # Start in dev mode (hot reload)
bun run build            # Build for production
bun run start            # Run built server
bun run check            # TypeScript type check
bun run test             # Run tests
bun run lint             # oxlint
bun run format           # oxfmt
```

## Conventions for this app

- Runs on Bun runtime (not Node.js). Use Bun APIs where appropriate.
- The server uses Hono (not Express, not Fastify) for HTTP routing.
- Import Pi SDK modules from `@earendil-works/pi-*` packages — do not add alternative agent SDKs.
- Module structure mirrors domain boundaries: one file per concept, grouped into extensions for separable subsystems.
- Extensions (guardrails, memory) have their own `index.ts` that exports the public API.
- Extension handlers implement a consistent handler interface.
- Do not use raw `console` — rely on Bun's built-in logging or Pi's event system.
- Keep the HTTP server layer thin (`app-routes.ts`) and push logic into domain modules.
- The agent Pi should not import from the desktop frontend or Tauri backend — it is an independent process.
