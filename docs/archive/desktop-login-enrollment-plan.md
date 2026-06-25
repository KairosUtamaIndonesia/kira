# Desktop Sign-In — Delivered Design

Status: **Implemented.** Supersedes the earlier device-authorization "enrollment" design (see ADR 0006).

## Model

Organization membership is the grant of access: a platform admin adds a user to an organization,
and that user signs in to the desktop app. There is no installation-approval step and no
organization-owner gate. Desktop access is authenticated by **browser sign-in**, which handles
email/password and SSO uniformly.

## Flow (loopback browser sign-in, RFC 8252)

1. Desktop "Sign in" binds a one-shot loopback listener on `http://127.0.0.1:<port>`, generates a
   CSRF `state`, opens the system browser to
   `https://cloud.kira.localhost/desktop-signin?redirect_uri=<loopback>&state=<state>`.
2. The admin page requires a session (redirects to `/sign-in` with a return-to, so the user lands
   back after authenticating — password or SSO). Once signed in it shows "Continue as <email>"
   with an organization picker only when the member belongs to more than one org.
3. On continue, admin mints a **user-referenced** desktop-access API key (a member may create their
   own key; no owner involved) with `metadata.organizationId`, stores it transiently against a
   one-time handoff code, and redirects to the loopback callback with `code` + `state`.
4. The desktop verifies `state`, claims the credential once via `POST /api/desktop/signin/claim`,
   stores it in the OS keychain (identity in `app_settings`), and opens the workspace.
5. `GET /api/desktop/models` resolves the organization from the key metadata and verifies the user
   is still a member before returning the catalog.

## Files

Admin (`apps/cloud/`)

- `lib/auth/auth.ts` — desktop-access `apiKey` config is user-referenced (org-reference removed).
- `app/api/desktop/models.ts` — resolves org from key metadata + membership check.
- `app/desktop-signin.tsx` — standalone, auth-guarded sign-in page (loopback handoff, org picker).
- `app/api/desktop/signin/claim.ts` — one-time handoff → credential.
- `features/desktop-signin/data/desktopSignin.ts` — handoff create/claim (SHA-256 hashed code).
- `features/organizations/data/organizations.ts` — `listOrganizationsForMember`,
  `userBelongsToOrganization`.
- `features/auth/components/SignInForm.tsx`, `app/_admin.tsx`, `app/sign-in.tsx` — return-to
  redirect preserved across sign-in for any role.
- `lib/db/schema.ts` + `drizzle/0004_wooden_luckman.sql` — `desktop_signin_handoffs` table (the
  device/installation tables were removed).

Desktop (`apps/desktop/`)

- `src-tauri/src/desktop_signin.rs` — `desktop_signin_status` / `desktop_signin_begin` (loopback +
  claim) / `desktop_sign_out`; OS-keychain credential store.
- `src-tauri/src/admin_api.rs` — shared admin HTTP client (dev loopback DNS + TLS handling).
- `src-tauri/src/org_config.rs`, `agent_runtime.rs` — read the stored credential.
- `src/features/desktop-auth/` — `SignInGate`, `SignInScreen`, `SignInShell`, api, types.
- `src/App.tsx` — `SignInGate` wraps the app shell.

## Follow-ups (not in this slice)

- A "Desktop sessions"/credential list with revoke in admin (the key is revocable; no UI yet).
- Reachability + structured catalog-failure gating after sign-in (Phases 2–3 of the original plan).
- Cancel for an in-flight sign-in (currently the loopback listener times out after 5 minutes).
