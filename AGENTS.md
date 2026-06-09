# AGENTS.md

## Required agent behavior

- Always load and follow the `canon` skill before non-trivial implementation, refactoring, debugging, code review, or configuration work.
- If the `canon` skill is unavailable, unreadable, or was not loaded before code work, stop and explicitly tell the user: `Canon skill was not loaded.` Then ask whether to proceed without it.
- Canon is the project default: prefer direct, exhaustive, fail-fast code. Do not preserve bad shapes for compatibility unless the user explicitly asks for compatibility.
- Before asking questions or editing, explore the relevant code path and project docs deeply enough to infer the likely answer from existing implementation, tests, naming, ownership, and documented decisions.
- Before editing, trace the relevant flow and owner. Prefer local feature ownership over vague shared utilities.
- Read `docs/domain-language.md` when it exists and use its terms consistently in names, UI copy, APIs, and model boundaries.
- Read relevant `docs/adr/*.md` when changing architecture, persistence, integrations, module boundaries, compatibility behavior, or cross-context communication.
- Surface conflicts between code, docs, user requests, domain language, and ADRs before implementation.
- Ask only questions that materially affect behavior, ownership, compatibility, domain language, or risk.
- Avoid hidden fallbacks: no silent defaulting, broad optional chaining, catch-and-ignore, or `unwrap`/`expect` style escapes unless deliberately justified.
- Verify with the strongest relevant checks before finishing.

## Project overview

Kira v3 is a Bun/Turborepo monorepo.

- Desktop app: `apps/desktop/` — Tauri 2 app with a Vite React frontend and Rust backend.
- Admin app: `apps/admin/` — hosted TanStack Start (SPA) admin panel/API.
- Shared TypeScript configs: `packages/tsconfig/`.

Desktop paths:

- Frontend root: `apps/desktop/src/`
- Tauri/Rust backend: `apps/desktop/src-tauri/`
- Vite entry: `apps/desktop/src/main.tsx`
- Global stylesheet: `apps/desktop/src/main.css`
- Main React app: `apps/desktop/src/App.tsx`
- shadcn/ui components: `apps/desktop/src/components/ui/`
- Shared desktop frontend helpers: `apps/desktop/src/lib/`
- Rust app library: `apps/desktop/src-tauri/src/lib.rs`
- Rust binary entrypoint: `apps/desktop/src-tauri/src/main.rs`

## Frontend stack

- React 19
- Vite 7
- TypeScript strict mode
- Tailwind CSS v4 via `@tailwindcss/vite`
- shadcn/ui with `base-nova` style
- Base UI, Lucide icons, `class-variance-authority`, `clsx`, `tailwind-merge`
- Bun is the package manager/runtime for scripts.

## Backend stack

- Tauri 2
- Rust 2021
- `tauri-plugin-opener`
- Serde / serde_json

Rust code uses strict crate-level lint policy in app files:

- deny unsafe code
- deny `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, and `dbg!`
- warn on `clippy::pedantic`

## Path aliases

Use the `@/*` alias for frontend imports from `src/`.

Examples:

```ts
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
```

Desktop alias config lives in:

- `apps/desktop/tsconfig.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/components.json`

Admin alias config lives in:

- `apps/admin/tsconfig.json`
- `apps/admin/components.json`

## Formatting and linting

Frontend:

```bash
bun run lint
bun run format
bun run format:check
```

Backend:

```bash
bun run lint:rust
bun run format:rust
bun run format:rust:check
bun run check:rust
bun run test:rust
```

All checks:

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

## UI changes

- For any UI, styling, component, Tailwind, or design-token change, read `docs/style-guide.md` before editing.
- Also load and follow the `css-canon` skill for CSS/Tailwind work.
- `apps/desktop/src/main.css` is the source of truth for desktop design tokens; do not hardcode colors in components when a token exists.

## Coding conventions

- Keep feature-specific code near the feature.
- Do not create generic dumping grounds. `src/lib/` is only for genuinely shared frontend utilities.
- Prefer explicit inputs and typed boundaries over defensive fallbacks.
- Prefer discriminated unions and exhaustive handling for state machines or modes.
- Do not use raw `console` in frontend code.
- Do not use `any`, non-null assertions, or unsafe TypeScript escape hatches.
- Do not use Rust `unwrap`/`expect`; propagate errors or handle them explicitly.
- For Tauri commands, keep command functions small and push domain logic into clearly named helpers/modules when behavior grows.

## Generated and ignored areas

Do not edit generated or build output unless explicitly asked.

- `dist/`
- `.output/`
- `node_modules/`
- `apps/desktop/src-tauri/target/`
- `apps/desktop/src-tauri/gen/`

## Common commands

Run the frontend dev server:

```bash
bun run dev
```

Run Tauri:

```bash
bun run tauri dev
```

Build frontend:

```bash
bun run build
```

Run full project check:

```bash
bun run check
```
