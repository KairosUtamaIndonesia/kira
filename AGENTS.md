# AGENTS.md

## Required agent behavior

- Before asking questions or editing, explore the relevant code path and project docs deeply enough to infer the answer from existing implementation, tests, naming, ownership, and documented decisions.
- Before editing, trace the relevant flow and owner. Prefer local feature ownership over vague shared utilities.
- Read `docs/domain-language.md` and use its terms consistently in names, UI labels, APIs, and model boundaries.
- Read relevant `docs/adr/*.md` when changing architecture, persistence, auth, integrations, module boundaries, compatibility behavior, or cross-context communication.
- Surface conflicts between code, docs, user requests, domain language, and ADRs before implementation.
- Ask only questions that materially affect behavior, ownership, compatibility, domain language, or risk.
- Avoid hidden fallbacks: no silent defaulting, broad optional chaining, catch-and-ignore, or `unwrap`/`expect` style escapes unless deliberately justified.
- Verify with the strongest relevant checks before finishing.

## Project structure

Kira v3 is a Bun/Turborepo monorepo.

| App/package | Directory | Role |
|---|---|---|
| Desktop | `apps/desktop/` | Tauri 2 (Vite React, Rust backend) |
| Cloud | `apps/cloud/` | TanStack Start SPA (TanStack Router + Vite + Nitro) |
| Agent Pi | `apps/desktop/agent-pi/` | Embedded agent runtime (Bun + Pi SDK) |
| `@kira/tsconfig` | `packages/tsconfig/` | Shared TypeScript configs |
| `@kira/api-types` | `packages/api-types/` | Wire-format types shared cloud↔desktop |

## Per-app rules files

Read the relevant file before working on that app:

- `apps/cloud/AGENTS.md` — Cloud app routing, security rules, database migrations
- `apps/desktop/AGENTS.md` — Desktop Tauri IPC, Rust module conventions, feature patterns
- `apps/desktop/agent-pi/AGENTS.md` — Agent runtime commands, architecture, SDK conventions

## Domain language

Always read `docs/domain-language.md` before naming anything. Key terms:

- App Shell, Workspace, Panel, Inspector, Sidebar, Status Bar
- Project, Session, Run, Agent Thread, Agent Session
- Desktop Sign-In, Desktop Credential, Loopback Callback
- SSO Provider, Identity Provider, SSO Domain
- Platform Console vs Organization Admin vs Platform Admin
- Skill, Skill Scope, Bundled Skill, Skill Conflict
- Persistence Store (SQLite via Rust)

## Architecture Decision Records

Read the relevant ADR before changing architecture, persistence, auth, integrations, module boundaries, or compatibility behavior. Key ADRs in `docs/adr/`:

| ADR | Decision |
|---|---|
| 0001 | Rust-owned SQLite persistence store via `sqlx` |
| 0002 | Monorepo with hosted admin boundary |
| 0003 | Organization-scoped SSO via Better Auth |
| 0004 | Multi-webview browser panel via Tauri `unstable` |
| 0005 | Cloud app uses TanStack Start SPA (not Next.js) |
| 0006 | Desktop authenticates via browser sign-in, not enrollment |
| 0007 | Cloud app split into 3 surfaces (Sign-In, Platform Console, Org Admin) |
| 0008 | Pi-native JSONL session files for Agent Threads |

## Path aliases

Use `@/*` for frontend imports from the app's `src/` (desktop) or root (cloud).

## Tooling policy

- TypeScript invariants belong in `tsconfig.json` when the compiler can enforce them better than lint rules.
- JS/TS linting: `oxlint` via `.oxlintrc.json`. Formatting: `oxfmt` via `.oxfmtrc.json`. Tailwind class sorting handled by `oxfmt`, not Prettier.
- Rust formatting: `cargo fmt` with `rustfmt.toml`. Linting: `cargo clippy --all-targets --all-features -- -D warnings` with `clippy.toml`.
- Git hooks: `lefthook` (see `lefthook.yml`). Install with `bun run setup:hooks`.
- Commits follow conventional commits enforced by `commitlint` in the `commit-msg` hook.

## UI changes

- For any UI, styling, component, Tailwind, or design-token change, read `docs/style-guide.md` first.
- Also load and follow the `css-canon` skill for CSS/Tailwind work.

## Coding conventions

- Keep feature-specific code near the feature. No generic dumping grounds — `src/lib/` is only for genuinely shared frontend utilities.
- Prefer explicit inputs and typed boundaries over defensive fallbacks.
- Prefer discriminated unions and exhaustive handling for state machines or modes.
- No raw `console` in frontend code. No `any`, non-null assertions, or unsafe TypeScript escape hatches.
- No Rust `unwrap`/`expect`; propagate errors with `?` or handle them explicitly.
- Desktop Rust code denies `unsafe`, `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, and `dbg!`. `clippy::pedantic` is warn-by-default.

## Database conventions

### Cloud (Drizzle + Postgres)

- Drizzle migrations are the **only** way schema reaches the database. After editing `apps/cloud/lib/db/schema.ts`: run `bun run db:generate` then `bun run db:migrate` **in order**.
- Never use `drizzle-kit push` — it writes without a ledger entry, desyncing migrations.
- Commit generated `.sql` and `drizzle/meta/*` together with the schema change.

### Desktop (SQLite via Rust)

- SQLite accessed only through the Rust backend via `sqlx`. Frontend never constructs SQL directly.
- Migrations are Rust-based `sqlx` migrations managed in the Rust build.

## Generated and ignored areas

Do not edit generated or build output unless explicitly asked.

- `dist/`, `.output/`, `node_modules/`, `.turbo/`, `.tanstack/`
- `apps/desktop/src-tauri/target/`, `apps/desktop/src-tauri/gen/`
- `apps/desktop/agent-pi/dist/`
- `*.tsbuildinfo`
