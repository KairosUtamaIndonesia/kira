# Desktop app (Tauri)

`apps/desktop/` is a Tauri 2 desktop application with a Vite + React frontend and Rust backend.

Read the root `AGENTS.md` and `docs/domain-language.md` before working on this app.

## Architecture overview

The desktop app has three layers:

```
┌─────────────────────────────────────┐
│  React Frontend (Vite)              │
│  apps/desktop/src/                  │
│  Features, components, hooks, lib   │
├─────────────────────────────────────┤
│  Tauri IPC (commands, events)       │
├─────────────────────────────────────┤
│  Rust Backend                       │
│  apps/desktop/src-tauri/src/        │
│  Tauri commands, domain logic, SQLite│
├─────────────────────────────────────┤
│  Embedded Agent Pi                  │
│  apps/desktop/agent-pi/             │
│  Subprocess managed by agent_runtime│
└─────────────────────────────────────┘
```

## Frontend

### Directory structure

```
src/
├── main.tsx                          # Vite entry point
├── main.css                          # Design tokens, Tailwind config
├── App.tsx                           # Root React component
├── components/
│   ├── ui/                           # shadcn/ui primitives
│   └── ai-elements/                  # AI-specific UI components
├── features/                         # Feature modules
│   ├── agent-thread/                 # Agent conversation thread
│   ├── app-shell/                    # App frame (sidebar, workspace, inspector, status bar)
│   ├── browser/                      # Embedded browser panel
│   ├── desktop-auth/                 # Desktop sign-in
│   ├── editor/                       # Code editor (Monaco)
│   ├── explorer/                     # File tree explorer
│   ├── memory/                       # Agent memory viewer
│   ├── onboarding/                   # First-run onboarding
│   ├── projects/                     # Project management
│   ├── search/                       # Full-text search
│   ├── settings/                     # App settings
│   ├── skills/                       # Agent skills management
│   ├── source-control/               # Git integration
│   └── updater/                      # App update UI
├── hooks/                            # Shared hooks
└── lib/                              # Shared utilities (cn, etc.)
```

### Feature module conventions

Each feature follows a consistent internal structure:

```
features/agent-thread/
├── api/              # Tauri invoke wrappers (typed IPC calls)
├── components/       # Feature-specific React components
└── hooks/            # Feature-specific React hooks
```

Some features have additional directories:

- `state/` — Zustand stores (app-shell, onboarding)
- `sections/` — Top-level page sections (memory, settings)
- `commands/` — Command palette entries (agent-thread)
- `store/` — File-system stores (explorer)

### IPC patterns

**Calling a Tauri command:**

```ts
import { invoke } from "@tauri-apps/api/core";

// Typed wrapper in the feature's api/ directory
export function projectList(): Promise<Project[]> {
  return invoke<Project[]>("project_list");
}

// With arguments
export function projectCreate(params: CreateProjectParams): Promise<Project> {
  return invoke<Project>("project_create", { name: params.name, path: params.path });
}
```

**Listening for events:**

```ts
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = await listen("terminal-output", (event) => {
    // event.payload is the deserialized payload
  });
  return () => unlisten();
}, []);
```

### State management

- **Zustand** for global app state (app-shell layout, onboarding progress)
- **React hooks + invoke** for feature-local data (projects, explorer, settings)
- **React context** sparingly, for deeply shared state (theme, session)
- Do not use Redux, MobX, or other external state libraries

### Key UI patterns

- **Workspace Panels**: dockable panels managed by `dockview-react` in the app-shell. Each panel type (editor, terminal, browser, agent-thread, source-control-diff) has create/open/delete/rename commands in the `projects` Rust module.
- **Browser Panel**: uses Tauri's `unstable` multi-webview API. Each browser panel is a native child webview with bounds managed by the `browser` Rust module.
- **Terminal Panel**: each panel attaches to a backend PTY session via the `terminal` Rust module. Session lifecycle: spawn → attach → write → resize → detach → kill.
- **Source Control**: git operations through `gix` (gitoxide) in the `source_control` Rust module. Operations: status, diff, stage/unstage, discard, commit.
- **Skills**: agent skills can be listed and expanded through the `skills` Rust module, which reads SKILL.md files from `.agents/skills/` directories.

## Backend (Rust)

### Module structure

```
src-tauri/src/
├── lib.rs                   # Plugin setup, state registration, command handler list
├── main.rs                  # Binary entry point (calls lib::run)
├── cloud_api.rs             # HTTP client for the cloud API
├── agent_runtime.rs         # Agent Pi lifecycle (start, generate, prepare)
├── browser.rs               # Multi-webview browser panel management
├── browser_selector.rs      # DOM element selector overlay injection
├── desktop_signin.rs        # Browser-based sign-in (loopback callback)
├── editor.rs                # File read/write/delete for code editor
├── explorer.rs              # File tree, directory listing, references
├── memory.rs                # Agent memory CRD
├── org_config.rs            # Organization model catalog, config
├── persistence.rs           # SQLite store initialization and health
├── projects.rs              # Project CRUD, sessions, workspace panels
├── search.rs                # Full-text project search (ripgrep-style)
├── settings.rs              # Appearance, notifications, terminal, guardrails
├── skills.rs                # Agent skill listing and expansion
├── source_control.rs        # Git operations (gix)
└── terminal.rs              # PTY terminal sessions (portable-pty)
```

### Writing a Tauri command

1. Define the command function in the appropriate module:

```rust
#[tauri::command]
pub fn my_command(arg: String) -> Result<String, String> {
    // Domain logic here
    Ok(format!("processed: {arg}"))
}
```

2. Register it in `lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands,
    my_command,
])
```

3. Add permissions to `capabilities/default.json` if the command uses a new capability.

4. For complex commands, push domain logic into helper functions/modules. Keep the command function as a thin layer over typed boundaries.

### State management

- Register state with `app.manage(MyState::default())` in `lib.rs` setup.
- Access in commands via `State<'_, MyState>` parameter.
- Guard concurrent access with `Mutex` or `RwLock` where needed.
- Current managed states: `PersistenceStore` (sqlx SqlitePool), `TerminalRegistry`, `AgentRuntimeRegistry`.

### Error handling

- Return `Result<T, String>` for simple Tauri commands.
- For richer errors, use `thiserror` to define domain error types and implement `serde::Serialize` so errors cross the IPC boundary cleanly.
- Never `unwrap` or `expect` — propagate errors with `?` or handle them explicitly.
- Never `panic!`, `todo!`, `unimplemented!`, or `dbg!` — these are denied by lint policy.

### Key dependencies

| Crate                  | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `tauri`                | App framework (with `unstable` feature for multi-webview) |
| `sqlx`                 | SQLite access (async, with migrations)                    |
| `portable-pty`         | PTY terminal sessions                                     |
| `gix`                  | Git operations (no libgit2 dependency)                    |
| `reqwest`              | HTTP client for the cloud API                             |
| `keyring`              | OS credential storage                                     |
| `axum`                 | Loopback HTTP server for desktop sign-in                  |
| `tauri-plugin-opener`  | Open URLs/files                                           |
| `tauri-plugin-dialog`  | Native file dialogs                                       |
| `tauri-plugin-updater` | App updates                                               |
| `tauri-plugin-process` | Process lifecycle                                         |

### Handling the Browser Panel (multi-webview)

The browser panel uses Tauri's `unstable` API. Key constraints:

- Window methods (`add_child`, etc.) require `tauri` crate with `features = ["unstable"]`.
- Each browser panel is a `window.add_child(WebviewBuilder, position, size)` call.
- Webview bounds must be updated on window resize.
- The element selector overlay is injected via `WebviewBuilder::initialization_script`.
- Orphan cleanup is handled by `browser::browser_close_orphans`.

## Agent Pi integration

The embedded agent runtime (`apps/desktop/agent-pi/`) runs as a subprocess managed by the `agent_runtime` Rust module.

The `agent_runtime` module handles:

- `start_agent_runtime` — Start the agent Pi subprocess
- `prepare_agent_thread` — Prepare context for a new thread
- `generate_commit_message` — AI commit message generation
- `generate_agent_thread_title` — AI thread title generation

Agent Thread traffic itself does NOT go through Rust: the frontend talks to the
agent Pi directly over a WebSocket (`/agents/:threadId/ws`), using the typed
wire protocol shared via `@kira/agent-pi/protocol` (a type-only workspace
devDependency plus the pure `messageDisplayId` helper). Frontend pieces:

- `features/agent-thread/agentThreadClient.ts` — typed socket client (commands + frames)
- `features/agent-thread/piTranscriptState.ts` — pure reducer over protocol frames
- `features/agent-thread/hooks/useAgentThreadConnection.ts` — connection lifecycle + state
- `features/agent-thread/hooks/useAutoTitle.ts` — first-prompt auto-titling

Protocol changes belong in `apps/desktop/agent-pi/src/protocol/index.ts` so both
ends break at compile time together.

Tauri commands in this module should keep the agent Pi lifecycle logic isolated — do not leak agent Pi internals into other modules.

## Common commands (from this directory)

```bash
bun run dev              # Frontend dev server (Vite)
bun run tauri dev        # Tauri development mode
bun run build            # Build frontend
bun run check            # Rust check + frontend build
bun run check:rust       # cargo check only
bun run lint             # oxlint
bun run lint:rust        # cargo clippy
bun run format           # oxfmt
bun run format:rust      # cargo fmt
bun run test:rust        # cargo test
```

## Conventions for this app

- Frontend imports use the `@/*` alias pointing to `src/`.
- shadcn/ui components live in `src/components/ui/` and use `cn()` for class merging.
- Use `cva()` from `class-variance-authority` for components with real variants.
- Keep `data-slot` attributes on shadcn-style primitive roots.
- New features get their own directory under `src/features/` with the `api/`, `components/`, `hooks/` subdirectory structure.
- Tauri command names use `snake_case` (e.g., `project_list`, `terminal_spawn`).
- Rust module names use `snake_case` filenames matching the command grouping.
- Tauri event names use `kebab-case` (e.g., `terminal-output`, `browser-navigated`).
- Frontend invoke wrappers live in the feature's `api/` directory and use the same name as the Tauri command.
- App settings are stored in SQLite and exposed via `settings::*_get` / `settings::*_update` command pairs per settings group.
- Do not add new Tauri plugins without evaluating the bundle size and permission impact.
