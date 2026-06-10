# 0003. Use Organization-Scoped Single Sign-On for Hosted Admin Authentication

## Status

Accepted. The desktop-enrollment decision in this ADR is superseded by ADR 0006 (the desktop authenticates via browser sign-in, not enrollment approval). The organization-scoped SSO decision for the hosted admin stands.

## Context

Kira's hosted admin app supports multiple organizations. Enterprise customers may require their members to authenticate through their own identity provider, such as Azure Entra ID, while other organizations continue to use the existing email/password and invitation flow.

The desktop app remains a separate enrollment-gated surface. Desktop enrollment credentials authorize an installation to phone home; they are not a replacement for hosted admin user authentication.

## Decision

Kira will use Better Auth's SSO plugin for organization-scoped Single Sign-On in the hosted admin app.

SSO providers are linked to organizations. A user's email domain, organization slug, or provider id can route sign-in to the correct organization identity provider. Successful SSO proves user identity, but Kira still owns organization authorization policy through memberships, invitations, roles, and organization status.

Initial SSO behavior is invite-only. Domain auto-join is not enabled by default.

## Consequences

- SSO provider configuration belongs to the hosted admin boundary.
- Organization-specific identity providers must not be presented as global social login options.
- Domain-based discovery requires domain ownership verification before it is trusted.
- Invitation and membership checks remain part of authorization after SSO sign-in.
- Desktop access is authenticated by browser sign-in gated on organization membership (see ADR 0006), reusing the same hosted-admin authentication including SSO.
