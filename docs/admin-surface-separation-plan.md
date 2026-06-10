# Admin Surface Separation Plan

Status: **Proposed.** Splits `apps/cloud` into three clearly-owned surfaces with
distinct authorization scopes, so the future Organization-admin panel (org-scoped
app data owned by org owners/admins) is cleanly separated from platform operations
and from the authentication gateway.

## Problem

`apps/cloud` currently serves three different audiences through a single shell and
a single guard, and the boundaries between them have collapsed:

- **Authentication gateway** (any member): `app/sign-in.tsx`, `app/desktop-signin.tsx`,
  `app/invitation-accepted.tsx`, `app/api/desktop/*`, `features/auth`,
  `features/desktop-signin`. Gated only by organization membership.
- **Platform operations** (Kira staff): `app/_admin/{dashboard,users,settings}.tsx`,
  `app/_admin/organizations/*` (the cross-tenant list), SSO connections. Onboarding
  and managing tenants.
- **Organization administration** (org owner/admin, the customer): everything under
  `app/_admin/organizations/$organizationId/*` — members, API keys, models,
  access-control, settings. Today done _by platform staff on behalf of_ tenants.

The conflation has two concrete failure modes:

1. **One guard, two scopes.** `app/_admin.tsx` authorizes with
   `session.user.role === "admin"` (Better Auth `admin` plugin = platform staff).
   Every org-scoped route hangs off that guard, so the only way to reach a tenant's
   members/models/credentials today is to be platform staff. The data functions
   (`getOrganizationForAdmin`, `listOrganizationMembersForAdmin`,
   `listOrganizationApiKeysForAdmin`, …) take only `organizationId` and perform **no
   membership/role check** — they trust the platform guard. There is no org-scoped
   authorization anywhere. An org owner cannot be given access to their own org
   without being made a platform admin.

2. **Members dead-end.** `app/invitation-accepted.tsx` tells every non-platform
   member "the hosted admin dashboard is only available to platform admins" and
   stops. Org owners/admins have nowhere to go. This is exactly the surface the
   future org-admin panel must fill.

Adding org-scoped app data on top of this (the stated future) would deepen the
conflation: org-owner features would inherit a platform-admin guard and data
functions that never check which org the caller may touch.

## Target model: three surfaces, three scopes

Keep **one deployed app** (`apps/cloud`), but split it into three internally-isolated
surfaces, each with its own pathless layout route, guard, shell, navigation, and
feature ownership. The split is along **authorization scope**, which is the axis that
actually differs:

| Surface                | Audience        | Auth scope      | Guard                                          |
| ---------------------- | --------------- | --------------- | ---------------------------------------------- |
| **Sign-In** (gateway)  | any member      | membership only | session exists + membership                    |
| **Platform Console**   | Kira staff      | platform        | `session.user.role === "admin"`                |
| **Organization Admin** | org owner/admin | per-org         | member of `:orgId` with role in {owner, admin} |

Why one app, not two deployables: ADR 0002/0005 already scope `apps/cloud` as the
single hosted surface; all three audiences share the same Better Auth backend,
Postgres, SSO, and session cookie. Splitting deployables now would duplicate the
auth wiring for no isolation gain. The segmentation below makes a future split (e.g.
`console.kira.app` vs `app.kira.app`) cheap: each surface is already a self-contained
route segment + feature folder + guard, so extraction is a move, not a rewrite. Record
this as an ADR (see Documentation).

### Domain language additions

Add to `docs/domain-language.md` so names stay consistent in routes, nav, and copy:

- **Platform Console** — the Kira-staff control plane for onboarding and operating
  tenants (organizations, platform users, SSO, global settings). _Avoid_: "the admin
  panel" as an umbrella term; it now means two different surfaces.
- **Organization Admin** — the tenant-scoped surface where an organization's owners
  and admins manage their own members, desktop credentials, models, and future
  app-specific data. _Avoid_: "org dashboard", "workspace settings".
- **Platform Admin** — a Better Auth `admin`-role user who operates the Platform
  Console. Distinct from an **Organization Admin/Owner** (a member role within one
  organization). _Avoid_: using "admin" unqualified.

## Authorization model (the crux)

Introduce two explicit, reusable guards and stop trusting the layout guard inside data
functions.

1. **Platform scope** — `requirePlatformAdmin()`: returns the session or
   `throw redirect({ to: "/sign-in" })` / `throw notFound()` when
   `session.user.role !== "admin"`. Used by the Console layout `beforeLoad` and by
   every platform-scoped server fn.

2. **Org scope** — `requireOrgRole(organizationId, allowedRoles)`: loads the caller's
   `member` row for that org and authorizes role ∈ `allowedRoles` (default
   `["owner", "admin"]`). Returns `{ session, member }`. Used by the Org-Admin layout
   `beforeLoad` and by every org-scoped server fn.

Authorization must live in the **server functions**, not only the route guard. SPA-mode
`beforeLoad` runs on the client and is a UX gate, not a security boundary; the
server-fn handler is the trust boundary. Today's `*ForAdmin` functions are unsafe the
moment a non-platform caller can invoke them, because they never check the caller. The
rule after this change: **every org-scoped server fn re-derives the caller's session and
calls `requireOrgRole(organizationId, …)` before touching data.**

This also fixes a latent bug: platform-scoped queries that "see all orgs" must stay
behind `requirePlatformAdmin`, while org-scoped queries must be authorized per-org. The
rename below makes the scope legible at every call site.

### Data-layer rename and split

`*ForAdmin` conflates "platform admin sees everything." Split by scope:

- **Platform-scoped** (cross-org, Console only): `listOrganizationsForPlatform`,
  `getOrganizationForPlatform`, platform user queries, dashboard rollups. Each asserts
  `requirePlatformAdmin` internally.
- **Org-scoped** (single org, authorized by caller membership): `getOrganization`,
  `listOrganizationMembers`, `listOrganizationApiKeys`, `listOrganizationModels`, …
  each takes `organizationId`, internally calls `requireOrgRole(organizationId, …)`,
  and operates only on that org.

The platform Console may reuse org-scoped reads for inspection, but does so through a
platform-authorized wrapper, not by bypassing the org check.

## Route structure

Rename the single `_admin` segment into three:

```
app/
  # Sign-In gateway (membership-only; no shell)
  sign-in.tsx
  desktop-signin.tsx
  invitation-accepted.tsx        # becomes a router, not a dead-end (below)
  api/desktop/*                  # unchanged

  # Platform Console (guard: requirePlatformAdmin)
  _console.tsx                   # pathless layout + ConsoleShell
  _console/
    dashboard.tsx
    organizations/               # cross-tenant onboarding/operations
      index.tsx
      $organizationId/...        # platform view of one tenant (read/operate)
    users.tsx
    settings.tsx

  # Organization Admin (guard: requireOrgRole(:orgId, [owner, admin]))
  _org.tsx                       # pathless layout + OrgAdminShell + org switcher
  _org/$organizationId/
    index.tsx                    # overview
    members.tsx
    api-keys.tsx
    models.tsx
    settings.tsx
    # future app-specific data lands here
```

Notes:

- The org-scoped routes currently under `_admin/organizations/$organizationId/*` are
  **moved**, not copied, to `_org/$organizationId/*`. The Platform Console keeps a
  thin platform view of a tenant (status, counts, operational actions) under
  `_console/organizations/$organizationId/`, but the day-to-day member/credential/model
  management is the org-admin surface.
- `access-control.tsx` is currently a static "managed by Better Auth" placeholder. It
  belongs to Org Admin once org RBAC is editable (see Future app data); until then it
  can stay a read-only placeholder under `_org`.

## Navigation and shells

Split `features/admin-shell` into two shells (the auth gateway has no shell):

- `features/console-shell/` — `ConsoleShell`, `ConsoleSidebar`, console
  `primaryNavigation` (Dashboard, Organizations, Users, Settings). This is the renamed
  current `admin-shell` minus the org-scoped nav.
- `features/org-admin-shell/` — `OrgAdminShell`, `OrgAdminSidebar`, the org switcher
  (visible only when the member belongs to >1 org, reusing `listOrganizationsForMember`),
  and org navigation (Overview, Members, API Keys, Models, Settings). This is the renamed
  `organizationNavigation`, rebased on `/_org/$organizationId/*`.

`features/admin-shell/navigation.ts` already separates `primaryNavigation` from
`organizationNavigation`; the split mostly follows that seam, repointing
`organizationNavigation`'s `to` values from `/organizations/$organizationId/*` to
`/_org/$organizationId/*` route ids.

### Feature ownership reorg

`features/organizations` currently mixes platform-list concerns, org-scoped management,
and auth/invitation helpers. Re-home by scope:

- `features/platform/organizations/` — cross-tenant list, onboarding, platform tenant
  view (the `*ForPlatform` data + components).
- `features/org-admin/{members,api-keys,models,settings}/` — org-scoped management
  (the `*` org-scoped data authorized by `requireOrgRole`, plus their components).
- `features/auth/` and `features/desktop-signin/` — unchanged (gateway). The
  invitation/sign-in helpers (`getInvitationSignInContext`, `getInvitationEmailForSignIn`,
  `listOrganizationsForMember`, `userBelongsToOrganization`) move to `features/auth/data`.

## invitation-accepted → post-auth router

Replace the member dead-end with a routing decision based on the caller's scopes
(computed in one server fn):

- Platform admin → redirect to `/_console/dashboard`.
- Member is owner/admin of ≥1 org → redirect to `/_org/$firstOrgId` (or an org picker
  when >1).
- Plain member only → the existing "use the desktop app" message (this is correct: a
  non-admin member has no web surface, only desktop sign-in).

This makes the three guards composable and gives every authenticated user a defined
landing.

## Future app-specific data (org-scoped)

When org owners/admins get controllable app data:

- New tables are **org-scoped** (carry `organizationId`), mirroring the existing
  `organization_models` / `desktop_access_policies` shape in `lib/db/schema.ts`. Every
  query is authorized by `requireOrgRole`.
- Editable permissions ride Better Auth's `organization` plugin RBAC (org roles), **not**
  the platform `admin` plugin. The `access-control` route becomes the editor for those
  org roles/permissions. Platform-level permissions stay on the `admin` plugin.
- This is purely additive under `_org/$organizationId/*`; no platform-console change.

## Migration phases

1. **Authorization spine.** Add `requirePlatformAdmin` and `requireOrgRole` in
   `lib/auth/`. Add org-scoped data fns (`getOrganization`, `listOrganizationMembers`,
   …) that call `requireOrgRole` internally. No route moves yet; Console keeps working.
2. **Split the Console.** Rename `_admin` → `_console`, `admin-shell` →
   `console-shell`, `*ForAdmin` platform queries → `*ForPlatform`. Console is
   green end-to-end behind `requirePlatformAdmin`.
3. **Stand up Organization Admin.** Add `_org.tsx` guard + `OrgAdminShell`, move the
   `$organizationId/*` management routes to `_org/$organizationId/*`, repoint nav, wire
   the org switcher. Each route's server fn authorizes via `requireOrgRole`.
4. **Route post-auth landing.** Rewrite `invitation-accepted.tsx` into the scope-based
   router above.
5. **Verification.** Server-fn authorization tests (the security boundary): platform
   query rejects non-admin; org query rejects a non-member and a member with role
   `member`; owner/admin passes. Route-guard redirect tests for each surface. Manual
   pass: platform admin sees Console; org owner (not platform admin) reaches only their
   org; plain member lands on the desktop-app message.

Each phase is shippable: after (2) the app behaves as today with clearer names; (3)
adds the org surface without touching the Console; (4) flips the landing.

## Documentation

- New ADR `0007-admin-surface-separation.md`: three scopes (gateway / platform /
  org), one deployable now, authorization in server fns, future-split path.
- Update `docs/domain-language.md` with **Platform Console**, **Organization Admin**,
  **Platform Admin**.
- Update `apps/cloud/AGENTS.md`: document the three route segments and the rule that
  **every org-scoped server fn calls `requireOrgRole`** (SPA `beforeLoad` is a UX gate,
  not a trust boundary).

## Non-goals

- Splitting into separate deployables (defer; the segmentation keeps it cheap).
- Editable org RBAC UI (depends on first concrete org-scoped app feature).
- Changing the desktop sign-in flow (ADR 0006) — the gateway is unchanged.

```

```
