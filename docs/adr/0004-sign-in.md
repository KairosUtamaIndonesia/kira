# Sign-in is the company's Entra ID tenant, in the system browser

Date: 2026-09-17

## Context

ADR 0003 puts model credentials on the server, so the desktop cannot reach a
model until the server knows which person is asking. That makes sign-in the first
thing `apps/server` needs, ahead of the proxy and the quota it meters.

Kira is an internal tool for one company's employees, reached from an Electron
app on their own machines. That shape decides most of this: the population is
known in advance, the identity already exists in the company's Microsoft Entra ID
tenant, and nobody needs to invent an account.

## Decision

**Better Auth's built-in `microsoft` provider**, which is the confidential OIDC
client here. The server holds the Entra client secret; the desktop never does,
and no Entra token is forwarded to it — Microsoft's own guidance is not to pass
credentials from a confidential client to a public one.

**Authorisation is the tenant, not the email address.** The provider's `tenantId`
is set to the company tenant's GUID. Left unset it defaults to `common`, which
accepts any Entra tenant, and that default is the trap: a concrete `tenantId` is
what scopes both the authorize and token endpoints to that one tenant, so
Microsoft's own endpoints are what refuse an account from anywhere else. The
issuer claim is not the mechanism — the code is redeemed against the
tenant-scoped token endpoint and the id_token is never verified, so nothing in
Kira checks `iss` or `tid` before the user row is written. Microsoft is
explicit that identity claims must not decide access — `email`,
`preferred_username` and `unique_name` are all unfit for it, and `domain_hint` is
only a hint to skip the account picker. Account identity is the `oid` claim.

Kira adds **no check of its own** on the way in. Better Auth's
`validateUserInfo` is the only hook that can reject a sign-in, and it is left
unset because there is no rule for it to state: the tenant pinning above is the
whole restriction, and a claim check beside it would restate it. It is not free
either — turning it on makes every user creation require an auth endpoint's
context, so it is a decision to make deliberately, when a concrete rule
deserves one.

**Sign-in happens in the system browser, never an embedded window.** Entra
documents WebView2 as unsupported for its authorities, and MFA, Conditional
Access and passkeys all depend on the shared browser surface — an Electron
`BrowserWindow` would work in testing and fail for the people whose accounts are
actually protected. The desktop opens the browser and the app is returned to by
**custom-protocol deep link**, through Better Auth's own Electron integration,
rather than a loopback listener. Loopback is Microsoft's documented preference for
desktop clients and the RFC 8252 recommendation, but Better Auth has no
documented loopback support, so choosing it means hand-rolling the exchange that
the library otherwise does. The deep link's exposure is bounded by a one-time
code with its own short expiry.

This means **the server serves the sign-in entry point**, because
`@better-auth/electron`'s flow expects a page on the web origin to start
`signIn.social` and then hand the app back. Kira has no web front end, so the
server grows one page — the smallest thing that can start the flow. Should that
prove awkward, Better Auth's `device-authorization` plugin (RFC 8628) is the
fallback: the user approves at Microsoft's own URL, and no Kira page is needed
at all, at the cost of a worse first run and a polling client.

**The desktop's own credential is a Better Auth `api-key`**, not its session.
Keys are issued per device, can expire, and are revoked individually — so signing
out of the app and cutting off a machine are separate acts, and neither reaches
into the other. It is independent of Entra's token lifetime as well: Better Auth
sessions are its own records, the provider's tokens sit unused in `account`, and
Entra is only ever called at sign-in. A long Kira session therefore does not
inherit Entra's short access-token life. That follows from Better Auth's schema
rather than from a documented sentence, so it is worth re-checking on upgrade.

## Consequences

There is no signup, no password, no email verification and no password reset.
Entra owns all four. Kira needs no mail provider, and the auth surface is
users, sessions and keys.

**On Linux the deep link is not delivered in development.** Registering a custom
scheme needs a desktop entry for the application, and a development build —
Electron running a script — has none, so `setAsDefaultProtocolClient` answers
false and the browser has nowhere to send the app. A packaged build has the entry
`protocols` in `electron-builder.yml` writes. A developer can register one by hand and get the
same path end to end, including the single-instance hand-over a packaged build uses — see
[`docs/internal/desktop-development.md`](../internal/desktop-development.md).

The fallback the integration offers
is a code the user copies out of the browser and pastes into the app, which
Kira does not build: its page would be the server's, and nothing in the desktop
accepts a pasted one.

A second company would break the assumption underneath this — one tenant, one
allowed population — so tenancy becomes a real concept at that point, not before.
