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
├── server.ts                     # Entry point — starts Hono HTTP server
├── app.ts                        # App bootstrap and initialization
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
    ├── skill-expansion.ts        # Skill SKILL.md loading and expansion
    ├── title-generation.ts       # Agent thread title generation
    ├── tool-ui-broker.ts         # Tool UI state bridge (WebSocket)
    ├── ws-transport.ts           # WebSocket transport for Pi runtime
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
2. **HTTP API**: The Tauri backend calls agent Pi endpoints (commit messages, thread titles, context usage)
3. **WebSocket**: The agent Pi provides a WebSocket transport (`ws-transport.ts`) for real-time tool UI events to the desktop frontend
4. **Auth**: Requests between the desktop and agent Pi use `auth.ts` for authentication (shared secret)

## HTTP routes

Defined in `src/kira/app-routes.ts`:

| Method | Route             | Purpose                               |
| ------ | ----------------- | ------------------------------------- |
| GET    | `/health`         | Health check                          |
| POST   | `/commit-message` | Generate commit message from git diff |
| POST   | `/thread-title`   | Generate thread title from messages   |
| POST   | `/thread-context` | Prepare thread context                |
| GET    | `/context-usage`  | Get context window usage              |
| POST   | `/session/start`  | Start an agent session                |
| POST   | `/session/stop`   | Stop an agent session                 |
| WS     | `/ws`             | WebSocket for tool UI events          |

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
