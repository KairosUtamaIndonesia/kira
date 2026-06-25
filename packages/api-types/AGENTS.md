# `@kira/api-types` — shared wire-format types

`packages/api-types/` defines TypeScript types shared between the cloud server
and the desktop app. Only types that cross the HTTP wire belong here.

## What belongs here

- Request/response shapes for cloud API endpoints
- Shared enums or discriminated unions used in API payloads
- Types referenced by both `apps/cloud/` server functions and `apps/desktop/`
  (or `apps/desktop/agent-pi/`) fetch wrappers

## What does NOT belong here

- Internal domain types used by only one app (cloud-only DB types,
  desktop-only IPC types, agent-pi-internal types)
- Frontend-specific UI state, component props, or hooks
- Anything that never appears in a serialized HTTP request or response

## Why a separate package

Before this package existed, the desktop app had to duplicate or manually
infer types from the cloud app's server function signatures. The shared
package eliminates drift: one source of truth for every JSON shape that
crosses the network boundary.

## Import path convention

Types are exported via subpath exports in `package.json`:

```ts
// Generic/shared types
import type { … } from "@kira/api-types";

// Scoped to a domain
import type { … } from "@kira/api-types/health";
import type { … } from "@kira/api-types/models";
import type { … } from "@kira/api-types/signin";
```

Add new subpath exports only when a domain has at least 3–4 exported types.
A single type can live in the barrel export.

## No build step

This package exports raw `.ts` sources consumed via workspace reference with
`moduleResolution: bundler`. There is no `tsc` or bundler build. Turborepo
resolves topological dependencies for typechecking only.

## Adding or updating a type

1. **Add the type** in the appropriate file under `src/`.
2. **Export it** from the barrel `src/index.ts` and/or the scoped entry point.
3. **Register the subpath** in `package.json` `exports` map if adding a new
   scoped entry.
4. **Update both consumers** — the cloud handler that produces the shape and
   the desktop code that consumes it — in the same PR or stacked change.
5. **Generate a migration** if a DB schema change is needed to support the
   new/updated type (cloud app convention: schema edit → `db:generate` →
   `db:migrate`).

## Deprecating a type

1. Add `/** @deprecated Use <replacement> instead. */` JSDoc to the type.
2. Leave the type in place for one release cycle so consumers can migrate.
3. Remove the type and its export in a follow-up PR.

## Coordination constraint

A change to a shared type that breaks the contract requires simultaneous
updates in both the cloud API handler and the desktop consumer. The PR
title or description should call this out (e.g. "feat(api): …" with a note
that desktop was updated in tandem).

## Current types

(To be populated — the package is scaffolded but not yet populated with types.)
