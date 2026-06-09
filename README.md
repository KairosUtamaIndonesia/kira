# Kira v3

Kira v3 is a Bun/Turborepo monorepo containing the Kira desktop app and the hosted admin panel.

## Repository layout

```txt
apps/
  admin/                    TanStack Start hosted admin panel and API
  desktop/                  Tauri 2 desktop app with Vite, React, and Rust
    agent-runtime/          Bun/TypeScript Pi SDK runtime managed by desktop
packages/
  tsconfig/                 Shared TypeScript configurations
```

## Requirements

- Bun
- Rust toolchain
- Tauri prerequisites for your operating system

## Common commands

Run all package checks:

```bash
bun run check
```

Build all packages:

```bash
bun run build
```

Format root docs/config and workspace packages:

```bash
bun run format
```

Check formatting:

```bash
bun run format:check
```

Lint workspace packages:

```bash
bun run lint
```

## Desktop app

The desktop app lives in `apps/desktop`.

Run the Vite dev server:

```bash
bun run dev:desktop
```

Run Tauri dev:

```bash
bun run tauri dev
```

Run desktop checks only:

```bash
bun run turbo check --filter=@kira/desktop
```

## Agent runtime

The desktop agent runtime lives in `apps/desktop/agent-runtime`.

It hosts Pi SDK sessions behind a JSONL stdio boundary for Rust/Tauri. Current status and remaining work are documented in [`apps/desktop/agent-runtime/README.md`](apps/desktop/agent-runtime/README.md).

Run runtime checks only:

```bash
bun run turbo check lint format:check --filter=@kira/agent-runtime
```

Run the real-provider prompt smoke test:

```bash
cd apps/desktop/agent-runtime
bun run smoke:prompt
```

## Admin app

The admin app lives in `apps/admin`.

Run the admin dev server:

```bash
bun run dev:admin
```

Run admin checks only:

```bash
bun run turbo check --filter=@kira/admin
```

Build admin only:

```bash
bun run turbo build --filter=@kira/admin
```

Copy `apps/admin/.env.example` to `apps/admin/.env.local` when adding hosted auth/database integrations.

## Tooling

- Package manager/runtime: Bun
- Task orchestration: Turborepo
- TypeScript shared configs: `packages/tsconfig`
- JavaScript/TypeScript linting: oxlint
- JavaScript/TypeScript formatting: oxfmt
- Rust linting: Cargo Clippy
- Rust formatting: rustfmt
