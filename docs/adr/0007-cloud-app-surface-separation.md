# 0007. Separate Cloud App into Three Authorization-Scoped Surfaces

## Status

Accepted. Supersedes the naming and scope of the hosted admin app in ADR 0002 and ADR 0005 (the monorepo and TanStack Start decisions still hold).

## Context

`apps/admin` served three audiences through a single `_admin` layout guard and conflated naming:

- Any authenticated member needed sign-in, desktop-signin, and invitation flows.
- Kira platform staff needed a control plane for onboarding and operating tenants.
- Organization owners and admins needed (and will increasingly need) a surface to manage their own org's members, credentials, models, and future app data.

The single `session.user.role === "admin"` guard protected both the platform control plane and the org-scoped views. Org-scoped data functions (`getOrganizationForAdmin`, `listOrganizationMembersForAdmin`, …) accepted only `organizationId` with no caller authorization check — they trusted the layout guard, which was only a client-side UX gate. An org owner could not be given web access to their own org without platform-admin privileges. The `invitation-accepted` page dead-ended non-platform members.

## Decision

Rename the app `apps/admin` → `apps/cloud` (`@kira/cloud`), hostname `cloud.kira.localhost`, and split its routes, shells, and feature code into three internally-isolated surfaces:

| Surface                | Audience              | Auth scope                            | Route segment                                                           |
| ---------------------- | --------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| **Sign-In gateway**    | Any member            | Session exists + membership           | `/sign-in`, `/desktop-signin`, `/invitation-accepted`, `/api/desktop/*` |
| **Platform Console**   | Kira platform staff   | `session.user.role === "admin"`       | `/_console/*`                                                           |
| **Organization Admin** | Org owners and admins | Per-org member role in {owner, admin} | `/org/$organizationId/*`                                                |

Keep one deployable — all three surfaces share the same Better Auth backend, Postgres, SSO, and session cookie. The segmentation makes a future deployable split (e.g. separate hostnames) a move, not a rewrite.

### Authorization model

Two reusable guards live in `lib/auth/guards.ts`:

- `requirePlatformAdmin()` — asserts `session.user.role === "admin"` (Better Auth `admin` plugin).
- `requireOrgRole(organizationId, allowedRoles?)` — loads the caller's `member` row and authorizes role ∈ `allowedRoles` (default `["owner", "admin"]`).

**Authorization lives in server functions, not only route `beforeLoad`.** SPA-mode `beforeLoad` runs on the client and is a UX gate, not a security boundary. Every platform-scoped server fn calls `requirePlatformAdmin()`; every org-scoped server fn calls `requireOrgRole(organizationId)` before touching data.

### Surface responsibilities

- **Sign-In gateway**: Membership-only. Handles email/password and SSO sign-in, desktop sign-in loopback flow (ADR 0006), invitation acceptance. No shell.
- **Platform Console** (`_console`): Kira staff control plane. Cross-tenant organization list/read, tenant onboarding (create org, invite first owner, configure SSO), platform user management, global settings. Console reads org data but org mutations belong to Org Admin.
- **Organization Admin** (`/org/$organizationId`): Tenant self-service. Members (invite/role/remove), Desktop API keys, AI model catalog, org settings. All mutations authorized by `requireOrgRole`. Future app-specific data lands here.

### Post-auth routing

`/` resolves via `resolvePostAuthDestination` (server fn):

- Platform admin → `/dashboard` (Console).
- Org owner/admin of one org → `/org/:id`.
- Org owner/admin of multiple orgs → org-picker.
- Plain member → `/invitation-accepted` (desktop-app message).

### Feature ownership

- `features/console-shell/` — Console shell, sidebar, breadcrumbs, primary navigation.
- `features/org-admin-shell/` — Org Admin shell, sidebar (resolves `$organizationId` from params), org navigation.
- `features/platform/organizations/` — Cross-tenant data fns (`*ForPlatform`), platform actions.
- `features/org-admin/{members,api-keys,models,settings}/` — Org-scoped data and actions authorized by `requireOrgRole`.
- `features/auth/data/membership.ts` — Membership/invitation helpers shared by gateway and org surfaces.

## Rejected alternatives

- **Split into separate deployables immediately**: rejected; one deployable shares auth, Postgres, and SSO with zero duplication. The surface segmentation makes a split cheap later.
- **Keep platform bypass for org mutations**: rejected; it creates two authorization paths and duplicated mutation UI. Org Admin owns all org mutations via `requireOrgRole`; platform staff join an org when they need to act as a member.
- **Pathless `_org` segment at root**: rejected; a bare `/:orgId` segment collides with `/dashboard` and other top-level routes. Real `/org/$organizationId` prefix is required.

## Consequences

- Desktop Rust constants updated: `ADMIN_HOST`, `ADMIN_SIGNIN_URL`, `ADMIN_CLAIM_URL`, `ADMIN_API_URL` → `cloud.kira.localhost`.
- External SSO redirect URIs (Azure Entra app registrations) must be re-registered to `cloud.kira.localhost` after deploy. Sign-in with SSO orgs will fail until this is done.
- `invitation-accepted` is no longer a dead-end for non-platform users; it shows a desktop-app link and is only reachable by plain members.
- `apps/admin/` directory is removed; references updated in Dockerfile, root `package.json`, README, and plan docs.
- ADR 0002's description of the hosted app as `apps/admin` is superseded by this ADR.
