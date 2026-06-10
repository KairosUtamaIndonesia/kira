# Kira v3

Kira v3 is a Bun/Turborepo monorepo containing the Kira desktop app and the hosted cloud app.

## Repository layout

```txt
apps/
  cloud/                    TanStack Start hosted web app (Sign-In, Platform Console, Org Admin)
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

## Cloud app

The cloud app lives in `apps/cloud`.

Run the cloud dev server:

```bash
bun run dev:cloud
```

Run cloud checks only:

```bash
bun run turbo check --filter=@kira/cloud
```

Build cloud only:

```bash
bun run turbo build --filter=@kira/cloud
```

Copy `apps/cloud/.env.example` to `apps/cloud/.env` when adding hosted auth/database integrations.

## Tooling

- Package manager/runtime: Bun
- Task orchestration: Turborepo
- TypeScript shared configs: `packages/tsconfig`
- JavaScript/TypeScript linting: oxlint
- JavaScript/TypeScript formatting: oxfmt
- Rust linting: Cargo Clippy
- Rust formatting: rustfmt
