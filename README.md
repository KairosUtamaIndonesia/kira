<p align="center">
  <img src="apps/desktop/src-tauri/icons/app-icon.svg" alt="Kira" width="128" height="128" />
</p>

# Kira

**Kira** is a local AI-assisted development desktop app. It brings AI agents directly into your development environment — not as a chat overlay, but as a deeply integrated workspace where agents can read, write, explore, search, and execute code alongside you.

Built with **Tauri 2** (Rust backend, React frontend) and complemented by a **hosted cloud app** for team management, Kira is designed for developers who want AI that works _in_ their project, not just _about_ it.

---

## Surfaces

Kira has three surfaces that work together:

### Desktop App

The primary surface — a full native desktop IDE powered by Tauri 2. It features:

- **Agent Threads** — Persistent conversational/workflow threads where AI agents run tasks, edit files, execute commands, and produce results. Threads are durable, searchable, and organized by Project and Session.
- **Code Editor** — Read, write, and navigate project files with editing support.
- **Terminal Panel** — Full PTY-based terminal sessions integrated into the workspace.
- **Source Control** — Git status, diff viewing, staging, discarding, and committing via `gix` (pure Rust).
- **File Explorer** — Tree-based project navigation with reference suggestions.
- **Browser Panel** — Multi-webview embedded browser for previewing and inspecting.
- **Project Management** — Named workspaces that own a folder on disk, a default Session, and zero or more Agent Threads.
- **Skills** — Reusable Agent Skills (`SKILL.md` + supporting files) that guide agent behavior for specialized tasks.
- **Settings** — Appearance, notifications, terminal, guardrails, and memory preferences.
- **Desktop Sign-In** — Browser-based authentication for organization membership, using a loopback callback (RFC 8252).
- **Full-Text Search** — Project-wide search across files.

The visual identity is **monochrome, quiet, and low-chrome**: neutral grays frame the user's work, while color is reserved for meaningful state — focus, destructive actions, status, and git decorations.

### Cloud App

A hosted web application (TanStack Start SPA + Nitro) with three surfaces:

- **Sign-In Gateway** — Authentication entry point, including organization-scoped SSO via Better Auth.
- **Platform Console** — Kira-staff web control plane for onboarding and managing tenant organizations.
- **Organization Admin** — Tenant-scoped web surface where organization owners and admins manage members, Desktop Credentials, AI model catalog, and app settings.

### Agent Runtime

An embedded agent subprocess (`agent-pi`) that runs alongside the desktop app. Built on the Pi SDK, it handles:

- Agent thread creation and lifecycle
- Context management and session state
- Commit message and thread title generation
- Full agent runtime execution

Communication between the Tauri backend and the agent runtime is over HTTP (Hono server), triggered through a Rust module bridge.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Kira Desktop (Tauri 2)                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  React Frontend (Vite + shadcn/ui + Tailwind v4)   │  │
│  │  ┌────────── ┌────────── ┌────────── ┌──────────┐  │  │
│  │  │ Agent     │ Terminal │ Source    │ Browser  │  │  │
│  │  │ Threads   │ Panel    │ Control   │ Panel    │  │  │
│  │  ├────────── ├────────── ├────────── ├──────────┤  │  │
│  │  │ Editor    │ Explorer │ Settings  │ Skills   │  │  │
│  │  └────────── └────────── └────────── └──────────┘  │  │
│  └───────────────────┬────────────────────────────────┘  │
│                      │ invoke / emit                      │
│  ┌───────────────────▼────────────────────────────────┐  │
│  │          Rust Backend (Tauri Commands)              │  │
│  │  SQLite · PTY · Git · HTTP Client · Loopback       │  │
│  └───────────────────┬────────────────────────────────┘  │
│                      │ HTTP                              │
│  ┌───────────────────▼────────────────────────────────┐  │
│  │          Agent Runtime (agent-pi)                   │  │
│  │  Pi SDK · Hono Server · SQLite Sessions            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────┘
                           │ API
┌──────────────────────────▼───────────────────────────────┐
│              Kira Cloud (TanStack Start SPA)              │
│  Sign-In Gateway · Platform Console · Organization Admin  │
│  Postgres · Better Auth · Drizzle ORM                    │
└──────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
kira-v3/
├── apps/
│   ├── desktop/                      # Tauri 2 desktop app
│   │   ├── src/                      # React frontend (Vite + TypeScript)
│   │   │   ├── features/             # Domain features
│   │   │   │   ├── agent-thread/     # Agent thread panels & transcripts
│   │   │   │   ├── app-shell/        # App Shell layout (sidebar, workspace, inspector)
│   │   │   │   ├── browser/          # Multi-webview browser panel
│   │   │   │   ├── desktop-auth/     # Desktop Sign-In flow
│   │   │   │   ├── editor/           # Code editor
│   │   │   │   ├── explorer/         # File tree & directory listing
│   │   │   │   ├── memory/           # Agent memory entries
│   │   │   │   ├── onboarding/       # First-run wizard
│   │   │   │   ├── projects/         # Project CRUD & session management
│   │   │   │   ├── search/           # Full-text search
│   │   │   │   ├── settings/         # Appearance, terminal, guardrails
│   │   │   │   ├── skills/           # Agent skill listing & expansion
│   │   │   │   ├── source-control/   # Git integration
│   │   │   │   └── updater/          # App update checker
│   │   │   ├── components/           # Shared UI components
│   │   │   │   ├── ui/               # shadcn/ui primitives
│   │   │   │   └── ai-elements/      # AI-specific components
│   │   │   ├── hooks/                # Shared React hooks
│   │   │   └── lib/                  # Shared frontend utilities
│   │   ├── src-tauri/                # Rust backend
│   │   │   └── src/                  # Domain modules (editor, terminal, git, etc.)
│   │   └── agent-pi/                 # Embedded agent runtime (Bun + Pi SDK)
│   └── cloud/                        # Hosted web app (TanStack Start SPA)
│       ├── app/                      # File-based routes
│       ├── components/               # UI components
│       ├── features/                 # Domain features
│       ├── lib/                      # Auth, DB, email, environment
│       └── drizzle/                  # Drizzle migrations
└── packages/
    └── tsconfig/                     # Shared TypeScript configs
```

---

## Tech Stack

| Layer               | Technology                                                    |
| ------------------- | ------------------------------------------------------------- |
| **Desktop Shell**   | Tauri 2 (with `unstable` feature for multi-webview)           |
| **Frontend**        | React 19 · TypeScript strict · Vite 7+ · Tailwind CSS v4      |
| **UI Components**   | shadcn/ui (base-nova style) · Base UI · Lucide icons          |
| **Desktop Backend** | Rust · Tokio async · SQLite (sqlx) · portable-pty · gix (git) |
| **Agent Runtime**   | Bun · Pi SDK · Hono · better-sqlite3                          |
| **Cloud Backend**   | TanStack Start SPA · Nitro · Postgres · Drizzle ORM           |
| **Auth**            | Better Auth (SSO, API keys, email/password)                   |
| **Linting**         | oxlint · oxfmt · Cargo Clippy · rustfmt                       |
| **Orchestration**   | Turborepo · Bun                                               |

---

## Prerequisites

- **Bun 1.3.12+** — package manager and runtime
- **Rust toolchain** (stable) with `clippy` and `rustfmt`
- **Docker** — required for the cloud app's Postgres database
- **Tauri system dependencies** — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

---

## Getting Started

```bash
# 1. Install dependencies
bun install

# 2. Set up git hooks (conventional commits)
bun run setup:hooks

# 3. Start Postgres (cloud app dependency)
docker compose up -d

# 4. Configure cloud environment
cp apps/cloud/.env.example apps/cloud/.env
# Edit apps/cloud/.env with your secrets

# 5. Run the desktop app (frontend only)
bun run dev:desktop

# Or run the full Tauri desktop app
bun run tauri dev

# 6. Run the cloud app (separate terminal)
bun run dev:cloud
```

---

## Common Commands

### Desktop

| Command              | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `bun run dev`        | Start Vite dev server                                 |
| `bun run tauri dev`  | Run full Tauri development mode                       |
| `bun run build`      | Build frontend                                        |
| `bun run check`      | Full project check (typecheck + lint + format + Rust) |
| `bun run check:rust` | Rust check only                                       |
| `bun run test:rust`  | Run Rust tests                                        |

### Cloud

| Command               | Description                      |
| --------------------- | -------------------------------- |
| `bun run dev:cloud`   | Start cloud dev server           |
| `bun run db:generate` | Generate Drizzle migration       |
| `bun run db:migrate`  | Apply Drizzle migration          |
| `bun run db:studio`   | Open Drizzle Studio              |
| `bun run seed:admin`  | Seed initial platform admin user |

### Agent Runtime

| Command         | Description                  |
| --------------- | ---------------------------- |
| `bun run dev`   | Run agent server in dev mode |
| `bun run build` | Build agent server           |
| `bun run check` | Typecheck                    |
| `bun run test`  | Run tests                    |

### General

| Command                    | Description                |
| -------------------------- | -------------------------- |
| `bun run format`           | Format all files           |
| `bun run format:check`     | Check formatting           |
| `bun run lint`             | Lint all packages          |
| `bun run lint:all`         | Lint all (frontend + Rust) |
| `bun run lint:fix`         | Auto-fix lint issues       |
| `bun run format:all:check` | Format check all           |

---

## Domain Language

Kira uses precise terminology throughout the codebase, UI, and documentation. Before contributing or extending, read [`docs/domain-language.md`](docs/domain-language.md) for canonical definitions of:

| Term                   | Meaning                                                         |
| ---------------------- | --------------------------------------------------------------- |
| **App Shell**          | The persistent frame: sidebar, workspace, inspector, status bar |
| **Workspace**          | The central dockable area for panels                            |
| **Panel**              | A dockable surface with its own title and lifecycle             |
| **Project**            | A named workspace owning a disk folder, sessions, and threads   |
| **Agent Thread**       | A durable conversational/workflow thread with an agent          |
| **Session**            | A container for Agent Threads within a Project                  |
| **Run**                | A tracked execution of an agent, command, or workflow           |
| **Skill**              | A reusable `SKILL.md` guide for agent behavior                  |
| **Desktop Sign-In**    | Browser-based auth proving organization membership              |
| **Platform Console**   | Kira-staff web control plane                                    |
| **Organization Admin** | Tenant-scoped web admin surface                                 |

---

## Architecture Decisions

Significant decisions are recorded as Architecture Decision Records in [`docs/adr/`](docs/adr/):

| ADR | Decision                                                               |
| --- | ---------------------------------------------------------------------- |
| 1   | Rust-owned SQLite persistence store via `sqlx`                         |
| 2   | Monorepo with hosted admin boundary                                    |
| 3   | Organization-scoped SSO via Better Auth                                |
| 4   | Multi-webview browser panel via Tauri `unstable` feature               |
| 5   | Cloud app uses TanStack Start SPA (not Next.js)                        |
| 6   | Desktop authenticates via browser sign-in, not enrollment              |
| 7   | Cloud app split into 3 surfaces (Sign-In, Platform Console, Org Admin) |
| 8   | Pi-native JSONL session files for Agent Threads                        |

---

## Style Guide

Kira's visual identity is deliberate and documented. Read [`docs/style-guide.md`](docs/style-guide.md) before making UI changes:

- **Monochrome canvas** — neutral grays carry the shell; color is meaningful
- **Token-driven** — every color is a CSS variable in `main.css`, never hardcoded
- **shadcn/ui primitives** — reach for existing components before writing custom CSS
- **Low-chrome** — quiet, functional, truthful UI that frames the user's work

---

## Contributing

This repository follows strict conventions:

- **Commits** follow [conventional commits](https://www.conventionalcommits.org/) (enforced by commitlint via lefthook).
- **TypeScript** uses strict mode with `oxlint` for linting and `oxfmt` for formatting.
- **Rust** forbids `unsafe`, `unwrap`, `expect`, `panic`, and `todo`. Clippy pedantic is warn-by-default.
- **Migrations** (cloud): edit `schema.ts`, then run `db:generate` + `db:migrate` — never `drizzle-kit push`.
- **Changes** should be surgical: touch only what you're asked to touch, prefer local feature ownership over shared utilities.

See [`AGENTS.md`](AGENTS.md) for detailed per-app rules and coding conventions.

---

## License

Not yet licensed. All rights reserved.
