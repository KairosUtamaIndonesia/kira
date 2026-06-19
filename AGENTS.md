# AGENTS.md

## Required agent behavior

- Always load and follow the `canon` skill before non-trivial implementation, refactoring, debugging, code review, or configuration work.
- If the `canon` skill is unavailable, unreadable, or was not loaded before code work, stop and explicitly tell the user: `Canon skill was not loaded.` Then ask whether to proceed without it.
- Canon is the project default: prefer direct, exhaustive, fail-fast code. Do not preserve bad shapes for compatibility unless the user explicitly asks for compatibility.
- Before asking questions or editing, explore the relevant code path and project docs deeply enough to infer the likely answer from existing implementation, tests, naming, ownership, and documented decisions.
- Before editing, trace the relevant flow and owner. Prefer local feature ownership over vague shared utilities.
- Read `docs/domain-language.md` and use its terms consistently in names, UI copy, APIs, and model boundaries.
- Read relevant `docs/adr/*.md` when changing architecture, persistence, auth, integrations, module boundaries, compatibility behavior, or cross-context communication.
- Surface conflicts between code, docs, user requests, domain language, and ADRs before implementation.
- Ask only questions that materially affect behavior, ownership, compatibility, domain language, or risk.
- Avoid hidden fallbacks: no silent defaulting, broad optional chaining, catch-and-ignore, or `unwrap`/`expect` style escapes unless deliberately justified.
- Verify with the strongest relevant checks before finishing.

## Project overview

Kira v3 is a Bun/Turborepo monorepo.

### Apps

| App      | Directory                | Tech                                                | Purpose                                                               |
| -------- | ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| Desktop  | `apps/desktop/`          | Tauri 2 (Vite React frontend, Rust backend)         | Local AI-assisted development desktop app                             |
| Cloud    | `apps/cloud/`            | TanStack Start SPA (TanStack Router + Vite + Nitro) | Hosted web app: sign-in gateway, Platform Console, Organization Admin |
| Agent Pi | `apps/desktop/agent-pi/` | Bun + pi-agent-core                                 | Embedded agent runtime used by the desktop app                        |

### Packages

| Package          | Directory            | Purpose                                             |
| ---------------- | -------------------- | --------------------------------------------------- |
| `@kira/tsconfig` | `packages/tsconfig/` | Shared TypeScript configs (base, next, node, react) |

### Desktop paths

- Frontend root: `apps/desktop/src/`
- Tauri/Rust backend: `apps/desktop/src-tauri/`
- Vite entry: `apps/desktop/src/main.tsx`
- Global stylesheet: `apps/desktop/src/main.css`
- Main React app: `apps/desktop/src/App.tsx`
- shadcn/ui components: `apps/desktop/src/components/ui/`
- AI-specific UI components: `apps/desktop/src/components/ai-elements/`
- Shared desktop frontend helpers: `apps/desktop/src/lib/`
- Hooks: `apps/desktop/src/hooks/`
- Rust app library: `apps/desktop/src-tauri/src/lib.rs`
- Rust binary entrypoint: `apps/desktop/src-tauri/src/main.rs`

Desktop features live in `apps/desktop/src/features/`:
`agent-thread`, `app-shell`, `browser`, `desktop-auth`, `editor`, `explorer`, `memory`, `onboarding`, `projects`, `search`, `settings`, `skills`, `source-control`, `updater`

Each feature follows a consistent structure with subdirectories for `api/`, `components/`, `hooks/`, and sometimes `state/`, `sections/`, `commands/`, or `store/`.

### Cloud paths

- App root: `apps/cloud/`
- Routes (file-based): `apps/cloud/app/`
- Components: `apps/cloud/components/ui/`
- Auth layer: `apps/cloud/lib/auth/`
- Database: `apps/cloud/lib/db/` (Drizzle + Postgres)
- Email: `apps/cloud/lib/email/`
- Environment config: `apps/cloud/lib/env.ts` (server) / `apps/cloud/lib/env-client.ts` (client)
- Migrations: `apps/cloud/drizzle/`
- Dockerfile: `apps/cloud/Dockerfile`

Cloud feature modules live in `apps/cloud/features/`:
`auth`, `console-shell`, `desktop-signin`, `org-admin`, `org-admin-shell`, `organizations`, `platform`, `sso`, `users`

### Agent Pi paths

- Agent runtime root: `apps/desktop/agent-pi/`
- Entry point: `apps/desktop/agent-pi/src/server.ts`
- Build output: `apps/desktop/agent-pi/dist/`

## Frontend stack

- React 19
- Vite 7+ (desktop), Vite 8 (cloud)
- TypeScript strict mode
- Tailwind CSS v4 via `@tailwindcss/vite`
- shadcn/ui with `base-nova` style
- Base UI, Lucide icons, `class-variance-authority`, `clsx`, `tailwind-merge`
- Bun is the package manager/runtime for scripts.

## Backend stack

### Desktop (Rust/Tauri)

- Tauri 2 (with `unstable` feature for multi-webview browser panel)
- `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-updater`, `tauri-plugin-process`
- SQLite via `sqlx` with async runtime (Tokio)
- `portable-pty` for terminal sessions
- `gix` (gitoxide) for source control (pure Rust, no libgit2)
- `reqwest` for HTTP API calls to the cloud app
- `keyring` for OS credential storage (Desktop Sign-In tokens)
- `axum` for the loopback callback HTTP server
- Serde / serde_json for serialization
- `thiserror` for error types

Rust modules (`apps/desktop/src-tauri/src/`):
`cloud_api`, `agent_runtime`, `browser`, `browser_selector`, `desktop_signin`, `editor`, `explorer`, `memory`, `org_config`, `persistence`, `projects`, `search`, `settings`, `skills`, `source_control`, `terminal`

Rust code uses strict crate-level lint policy in app files:

- deny unsafe code
- deny `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, and `dbg!`
- warn on `clippy::pedantic`

### Cloud (Nitro server)

- TanStack Start SPA (TanStack Router + Vite + Nitro), server-rendered root shell only
- Postgres via `drizzle-orm` with `pg` driver
- Better Auth for authentication (SSO, API keys, email/password)
- `nodemailer` for email (invitations)
- `@t3-oss/env-core` for validated environment variables
- `zod` for schemas and validation
- `sonner` for toasts
- `framer-motion` for animations

### Agent Pi

- Bun runtime using `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`
- Hono HTTP server for desktop ↔ agent communication
- SQLite via `better-sqlite3` for agent session state

## Local development setup

### Prerequisites

- **Bun 1.3.12+** (package manager, runtime)
- **Rust toolchain** (stable) with `clippy` and `rustfmt`
- **Docker** (for cloud app Postgres)

### Getting started

```bash
# Install dependencies
bun install

# Set up git hooks
bun run setup:hooks

# Start Postgres (cloud app dependency)
docker compose up -d

# Copy and configure cloud environment
cp apps/cloud/.env.example apps/cloud/.env
# Edit apps/cloud/.env with your secrets

# Run desktop dev server (frontend only)
bun run dev:desktop

# Run Tauri desktop app
bun run tauri dev

# Run cloud app
bun run dev:cloud
```

### Cloud app environment variables

The cloud app uses `apps/cloud/.env` (see `.env.example` for all vars):

| Variable             | Description                           |
| -------------------- | ------------------------------------- |
| `DATABASE_URL`       | Postgres connection string            |
| `BETTER_AUTH_SECRET` | Better Auth encryption key            |
| `BETTER_AUTH_URL`    | Public URL of the app                 |
| `SEED_ADMIN_*`       | Initial platform admin credentials    |
| `SMTP_*`             | Email provider config for invitations |

## Domain language

**Always read `docs/domain-language.md` before naming anything — new types, UI labels, API fields, features, or module boundaries.** It defines canonical terms for:

- App Shell, Workspace, Panel, Inspector, Sidebar, Status Bar
- Project, Session, Run, Agent Thread, Agent Session
- Desktop Sign-In, Desktop Credential, Loopback Callback
- SSO Provider, Identity Provider, SSO Domain
- Platform Console vs Organization Admin vs Platform Admin
- Skill, Skill Scope, Bundled Skill, Skill Conflict
- Persistence Store (SQLite via Rust)

When the user uses a conflicting or vague term, map it to the canonical term from `docs/domain-language.md`. Ask only when the difference could represent a distinct domain concept.

## Architecture Decision Records

Key ADRs in `docs/adr/` that affect daily work:

| ADR  | Decision                                                                |
| ---- | ----------------------------------------------------------------------- |
| 0001 | Rust-owned SQLite persistence store via `sqlx`                          |
| 0002 | Monorepo with hosted admin boundary (still holds; framework superseded) |
| 0003 | Organization-scoped SSO via Better Auth                                 |
| 0004 | Multi-webview browser panel via Tauri `unstable` feature                |
| 0005 | Cloud app uses TanStack Start SPA (not Next.js)                         |
| 0006 | Desktop authenticates via browser sign-in, not enrollment               |
| 0007 | Cloud app split into 3 surfaces (Sign-In, Platform Console, Org Admin)  |
| 0008 | Pi-native JSONL session files for Agent Threads                         |

Read the relevant ADR before changing architecture, persistence, auth, integrations, module boundaries, or compatibility behavior.

## Per-app rules files

Each app has its own `AGENTS.md` with app-specific conventions:

- `apps/cloud/AGENTS.md` — Cloud app routing, security rules, database migrations
- `apps/desktop/AGENTS.md` — Desktop Tauri IPC, Rust module conventions, feature patterns (read before working on desktop Rust or frontend features)
- `apps/desktop/agent-pi/AGENTS.md` — Agent runtime commands, architecture, SDK conventions (read before modifying the embedded agent)

## Path aliases

Use the `@/*` alias for frontend imports from the app's `src/` (desktop) or root (cloud).

Desktop examples:

```ts
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
```

Cloud examples:

```ts
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
```

Desktop alias config lives in:

- `apps/desktop/tsconfig.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/components.json`

Cloud alias config lives in:

- `apps/cloud/tsconfig.json`
- `apps/cloud/components.json`

## Formatting and linting

### Frontend (desktop + cloud + agent-pi)

```bash
bun run lint           # oxlint — all apps
bun run lint:fix       # oxlint with auto-fix
bun run format         # oxfmt — root files + all apps
bun run format:check   # oxfmt check — root files + all apps
bun run lint:all       # frontend + Rust linting
bun run format:all:check  # frontend + Rust formatting check
```

### Backend (desktop Rust only)

```bash
bun run lint:rust      # cargo clippy
bun run format:rust    # cargo fmt
bun run format:rust:check  # cargo fmt --check
bun run check:rust     # cargo check
bun run test:rust      # cargo test
```

### Cloud-specific

```bash
bun run dev:cloud                 # Start cloud dev server
bun run db:generate               # Drizzle: generate migration
bun run db:migrate                # Drizzle: apply migration
bun run db:studio                 # Drizzle: open studio UI
bun run seed:admin                # Seed initial platform admin
```

### All checks

```bash
bun run lint:all
bun run format:all:check
bun run check
```

## Tooling policy

- TypeScript invariants belong in `tsconfig.json` when the compiler can enforce them better than lint rules.
- JavaScript/TypeScript linting uses `oxlint` via `.oxlintrc.json`.
- JavaScript/TypeScript formatting uses `oxfmt` via `.oxfmtrc.json`.
- Tailwind class sorting is handled by `oxfmt`, not Prettier.
- Rust formatting uses `cargo fmt` with `rustfmt.toml`.
- Rust linting uses `cargo clippy --all-targets --all-features -- -D warnings` with `clippy.toml`.
- Git hooks managed by `lefthook` (see `lefthook.yml`). Install with `bun run setup:hooks`.
- Commits follow [conventional commits](https://www.conventionalcommits.org/) enforced by `commitlint` in the `commit-msg` hook.

## UI changes

- For any UI, styling, component, Tailwind, or design-token change, read `docs/style-guide.md` before editing.
- Also load and follow the `css-canon` skill for CSS/Tailwind work.
- `apps/desktop/src/main.css` is the source of truth for desktop design tokens; do not hardcode colors in components when a token exists.
- Cloud app CSS lives in `apps/cloud/app/globals.css` (imported as a side-effect in `__root.tsx`).

## Coding conventions

- Keep feature-specific code near the feature.
- Do not create generic dumping grounds. `src/lib/` is only for genuinely shared frontend utilities.
- Prefer explicit inputs and typed boundaries over defensive fallbacks.
- Prefer discriminated unions and exhaustive handling for state machines or modes.
- Do not use raw `console` in frontend code.
- Do not use `any`, non-null assertions, or unsafe TypeScript escape hatches.
- Do not use Rust `unwrap`/`expect`; propagate errors or handle them explicitly.
- For Tauri commands, keep command functions small and push domain logic into clearly named helpers/modules when behavior grows.
- Each desktop feature follows consistent subdirectory structure: `api/`, `components/`, `hooks/` (plus `state/`, `sections/`, `commands/`, or `store/` as needed).

## Database conventions

### Cloud (Drizzle + Postgres)

- Drizzle migrations are the **only** way schema reaches the database. They are mandatory, never optional.
- After editing `apps/cloud/lib/db/schema.ts`, always run both commands **in order**:
  1. `bun run db:generate` — writes a new `drizzle/NNNN_*.sql` and journal entry.
  2. `bun run db:migrate` — applies it and records it in the `__drizzle_migrations` ledger.
- Never use `drizzle-kit push`. It writes to the DB without recording a ledger entry, desyncing migrations.
- Commit the generated `.sql` and `drizzle/meta/*` files together with the schema change. A schema edit without its migration is a broken change.

### Desktop (SQLite via Rust)

- SQLite is accessed only through the Rust backend via `sqlx`.
- The React frontend reads and mutates persisted data through Tauri commands, never by constructing SQL directly.
- Migrations are Rust-based `sqlx` migrations managed in the Rust build.

## Cloud app security rules

- **Every org-scoped server fn MUST call `requireOrgRole(organizationId)` before touching data.** SPA `beforeLoad` is a UX gate, not a security boundary.
- **Every platform-scoped server fn MUST call `requirePlatformAdmin()` before touching data.**
- Server-only access (DB, Better Auth, `@/lib/env`) must stay inside server function handlers or server routes. Client env lives in `@/lib/env-client` (`import.meta.env`, `VITE_`-prefixed).

## Generated and ignored areas

Do not edit generated or build output unless explicitly asked.

- `dist/`
- `.output/`
- `node_modules/`
- `.turbo/`
- `.tanstack/`
- `apps/desktop/src-tauri/target/`
- `apps/desktop/src-tauri/gen/`
- `apps/desktop/agent-pi/dist/`
- `*.tsbuildinfo`

## Common commands

### Desktop

```bash
bun run dev                           # Start frontend dev server
bun run tauri dev                     # Run Tauri development mode
bun run build                         # Build frontend
bun run check                         # Full project check (typecheck + lint + format:check + Rust check)
bun run check:rust                    # Rust check only
bun run test:rust                     # Run Rust tests
```

### Cloud

```bash
bun run dev:cloud                     # Start cloud dev server (portless cloud.kira vite dev)
bun run db:generate                   # Generate Drizzle migration
bun run db:migrate                    # Apply Drizzle migration
bun run db:studio                     # Open Drizzle Studio
bun run seed:admin                    # Seed platform admin user
```

### Agent Pi

```bash
bun run dev                           # Run agent server in dev mode (from apps/desktop/agent-pi/)
bun run build                         # Build agent server
bun run check                         # Typecheck
bun run test                          # Run tests
```

### General

```bash
bun run setup:hooks          # Install lefthook git hooks
bun run lint:all             # Lint all (frontend + Rust)
bun run format:all:check     # Format check all
bun run format               # Format all (auto-fix)
```

## Rust backend module structure

Desktop Rust modules in `apps/desktop/src-tauri/src/` are organized by domain:

| Module                         | Responsibility                                                 |
| ------------------------------ | -------------------------------------------------------------- |
| `cloud_api`                    | HTTP client for the cloud API                                  |
| `agent_runtime`                | Agent Pi lifecycle management                                  |
| `browser` / `browser_selector` | Embedded webview browser panel + element selector              |
| `desktop_signin`               | Browser-based sign-in flow (loopback callback)                 |
| `editor`                       | File read/write/delete for the code editor                     |
| `explorer`                     | File tree, directory listing, reference suggestions            |
| `memory`                       | Agent memory entries (CRD)                                     |
| `org_config`                   | Organization configuration (model catalog, etc.)               |
| `persistence`                  | SQLite persistence store initialization and health             |
| `projects`                     | Project CRUD, session management, workspace panels             |
| `search`                       | Full-text project search                                       |
| `settings`                     | App settings (appearance, notifications, terminal, guardrails) |
| `skills`                       | Agent skill listing and expansion                              |
| `source_control`               | Git status, diff, stage/discard, commit                        |
| `terminal`                     | PTY terminal session management (spawn, resize, I/O)           |

All Tauri commands are registered in `lib.rs` via `tauri::generate_handler![]`.

## Desktop Tauri IPC patterns

- **Commands** (`#[tauri::command]`): registered in `lib.rs`, return `Result<T, E>` where `E: Serialize`. Frontend calls via `invoke("command_name", { args })` from `@tauri-apps/api/core`.
- **Events**: emitted from Rust via `app_handle.emit("event-name", payload)`, listened on the frontend via `listen("event-name", callback)` from `@tauri-apps/api/event`.
- **State management**: Rust state is registered with `app.manage()` (e.g., `TerminalRegistry`, `AgentRuntimeRegistry`, `PersistenceStore`). Commands access it via `State<'_, T>` parameter injection.
- **Permissions**: declared in `apps/desktop/src-tauri/capabilities/default.json`. Add new permissions there when adding capabilities or plugins.
- **Desktop sign-in**: uses a one-shot loopback HTTP server (`axum` on `127.0.0.1`) following RFC 8252 native-app pattern.

## Agent Pi architecture

The embedded agent runtime (`apps/desktop/agent-pi/`) runs as a subprocess managed by the Tauri backend (`agent_runtime` module). It serves:

- Agent thread creation, context management
- Commit message generation
- Agent thread title generation
- Full agent runtime execution

Communication between the Tauri backend and the agent Pi is over HTTP (Hono server in agent-pi, triggered by the desktop through the `agent_runtime` Rust module).
