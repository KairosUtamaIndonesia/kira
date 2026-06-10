# 0006. Desktop Authenticates via Browser Sign-In, Not Enrollment Approval

## Status

Accepted. Supersedes the desktop-enrollment decision recorded in ADR 0003 (the desktop is no longer a "separate enrollment-gated surface"; it is a sign-in surface).

## Context

The desktop app needs a credential to reach the hosted admin API (currently the organization model catalog) before its workspace and agent runtime can start.

An earlier design treated the desktop as enrollment-gated: an installation requested a device code, and an organization owner approved that installation in the admin web app (an OAuth 2.0 Device Authorization Grant). In practice this was the wrong shape:

- Organization membership is already the grant of access. A platform admin adds a user to an organization; that user is then expected to use the desktop app. A second, owner-performed "approve this installation" step contradicts that — it asks someone else to authorize access the member already has.
- Device-grant minting fell on Better Auth's organization-referenced API keys, whose default access control only lets the org **owner** create keys. That made "who approves" an accident of a library default rather than a product decision.

## Decision

Desktop access is authenticated by **browser sign-in**, gated only by organization membership.

- The desktop opens the system browser to a dedicated admin sign-in page and listens on a one-shot loopback callback (`http://127.0.0.1:<port>`, RFC 8252 native-app pattern). The browser handles email/password and SSO uniformly.
- After the user authenticates, the admin page mints a **user-referenced** desktop-access API key (a member may create their own key; no owner approval) with the chosen organization recorded in the key's metadata, and redirects to the loopback callback with a one-time handoff code. Binding the callback to the initiating desktop's loopback listener is what makes the handoff phishing-resistant, so no visible verification code is required.
- The desktop claims the credential once via the handoff code and stores it in the OS keychain. `/api/desktop/models` resolves the organization from the key metadata and verifies the user is still a member of it.

There is no installation entity, no approval step, and no organization-owner gate in this flow.

## Rejected alternatives

- **Device Authorization Grant with owner approval**: rejected; it re-authorizes access membership already grants and depends on org-owner-only key minting.
- **In-app email/password form**: rejected as the sole path because it cannot carry SSO organizations through their identity provider; the browser handles both.
- **Long-lived session cookie handed to the desktop**: rejected; a revocable, user-owned API key is the clearer durable credential for the background agent runtime.

## Consequences

- The desktop is a sign-in surface, not an enrollment surface. ADR 0003's statement that "desktop enrollment remains independent from hosted admin SSO" no longer holds: desktop sign-in deliberately reuses the same browser authentication, including SSO.
- Desktop credentials are user-referenced and individually revocable as API keys; there is no separate installation registry.
- The admin sign-in flow must preserve a return-to destination so a signed-out user lands back on the desktop sign-in page after authenticating.
- Membership changes (removal from an organization) revoke desktop access at the next `/api/desktop/models` call, which verifies membership.
