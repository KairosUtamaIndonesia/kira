# 0002. Use a Monorepo with a Hosted Admin Boundary

## Status

Accepted

## Context

Kira now needs two deployable surfaces:

- The existing desktop application, which owns local runtime UX and local persistence through its Rust backend.
- A hosted SaaS admin panel/API for authentication, organizations, users, RBAC, API keys, and future desktop access checks.

The desktop app must later phone home to the hosted admin API, but it should not directly own hosted authentication, organization management, or Postgres persistence.

## Decision

Kira will use a Bun/Turborepo monorepo:

- `apps/desktop`: the Tauri desktop app, including its Vite React frontend and Rust backend.
- `apps/admin`: the hosted Next.js admin panel/API.
- `packages/tsconfig`: shared TypeScript compiler configurations.

The hosted admin app will own cloud auth and organization state. The desktop app will integrate with it over explicit HTTPS/API boundaries.

The desktop app keeps its Rust-owned local SQLite Persistence Store from ADR 0001. The admin app will use Postgres for hosted SaaS data.

## Consequences

- Root `package.json` is an orchestration package, not an application package.
- App-specific dependencies and scripts belong to each app package.
- Root commands should use Turborepo for workspace tasks.
- Root-only docs/config formatting must still be handled explicitly outside Turbo package tasks.
- Shared packages should be added only for stable cross-app contracts or tooling, not as generic dumping grounds.
- The desktop app must not directly connect to the admin app's Postgres database.
