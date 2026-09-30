# Pool management is mediated by Kira

Date: 2026-09-30

## Context

The Pool is shared by every Kira user (ADR 0003). Its provider Credentials live
in CLIProxyAPI's auth directory, and its management API can read and delete those
Credentials. The admin console already has a Kira admin role (ADR 0007), per-user
Allowances (ADR 0005), and a server-side boundary through which desktop traffic
passes. Giving the browser direct access to CLIProxyAPI would expose its powerful
management secret and add a second identity and authorization surface.

CLIProxyAPI v7.3.7 has `/v0/management` endpoints for inventory, OAuth, and auth
file actions. The API is version-specific; upstream documentation may describe a
newer API. Its OAuth redirects target localhost on the browser's machine, and
the management API supports relaying a pasted callback URL. Five bad management
key attempts from an IP can ban that IP for 30 minutes.

## Decision

**The admin console talks only to Kira. Kira's server mediates all CLIProxyAPI
management calls.** The browser uses Kira's existing Entra sign-in and admin role;
the management secret is never returned to or stored by the browser. One server
adapter owns the v7.3.7 management API contract.

**Management is optional and isolated from boot.** Production may omit
`MANAGEMENT_PASSWORD`; the rest of Kira works and the Pool console reports that
management is not configured. Development uses a fixed local-only key. The
production deployment passes the same secret to Kira and CLIProxyAPI through the
private Docker network and does not publish proxy ports or the bundled panel.
If a management request receives 401 or 403, Kira remembers the rejection for the
life of that server process and sends no further management calls. This prevents
a bad configuration from triggering CLIProxyAPI's IP ban.

**The browser completes remote OAuth by pasting the localhost callback URL into
Kira.** Kira relays it to the proxy and polls the proxy-owned pending state. Kira
does not persist that state. Callback URLs, codes and tokens are sensitive and
must not appear in logs or audit records. Expired or unknown state requires a new
login.

**Audit facts are append-only and contain no secrets.** Each attempted
credential-management action records actor, time, action, provider, safe account
label, outcome, and a sanitized detail. The schema has no place for provider
tokens, management keys, raw auth files, or OAuth callback URLs.

**Pool health is live, not historical.** The console refreshes the proxy's
credential status, cooldowns, and available rate-limit signals while open. Kira
does not persist health snapshots or invent an aggregate remaining-capacity
figure that the proxy does not provide. User Usage and Allowances remain in
Kira's own ledger.

The initial OAuth providers are Codex and Claude. Other provider flows and
config-file API-key providers are out of scope for this interface.

## Consequences

The server becomes the security boundary for an upstream management API that can
change shared access. Every route must require an admin session, every upstream
operation must stay inside the adapter, and safe audit data must be written for
attempts. The proxy auth directory remains writable for OAuth, but the config
file does not need to be writable for the supported subscription-login flows.

The pasted callback flow works when the proxy runs on another host without
publishing provider callback ports. OAuth state still exists only in the proxy,
so reloading the console loses the in-progress UI context; the admin may restart
that login.

The API adapter is coupled to v7.3.7. A proxy upgrade, particularly to v8, needs
an explicit compatibility check and adapter migration rather than silently
following the latest upstream documentation.

## Revisit when

Kira upgrades CLIProxyAPI, adds another management role, needs durable Pool health
history, or needs provider configuration beyond subscription logins.
