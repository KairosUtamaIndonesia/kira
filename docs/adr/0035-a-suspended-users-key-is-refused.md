# A suspended User's Key is refused at the shared boundary

Date: 2026-10-06

## Context

ADR 0007 gives the console a ban, and the desktop authenticates with a Kira Key rather than a
session (ADR 0004, ADR 0006). Better Auth's ban revokes the user's sessions and blocks new
sign-ins, but it leaves the `apikey` rows alone, and `verifyApiKey` never reads the owner's
`banned` flag. So a suspended User's desktop Key keeps authenticating until its 90-day expiry:
suspension would read as done in the console while the person carried on working.

## Decision

**`keyHolder` refuses a User whose `banned` flag is set.** It is the one place both callers of a
Key — the desktop's own check and the model proxy — ask who the caller is
(`apps/server/src/keys.ts`), so the check there makes suspension mean one thing everywhere rather
than two things that drift.

**Suspension is Better Auth's ban, named Suspended.** The console calls `ban-user`, and Kira
overrides the plugin's `bannedUserMessage` so the person reads Kira's word rather than "banned".
Keys are not deleted: the check makes them inert, and reactivating restores the same device
without a fresh sign-in.

## Consequences

A suspended User's desktop signs out on its next request through the existing invalid-key path
(ADR 0006), then cannot sign in again until an administrator reactivates them.

The check lives at the shared boundary rather than in the console, so a ban applied by any path —
not only the console — cuts off a Key.

## Revisit when

Better Auth's api-key plugin checks the owner's ban state itself, or Kira stops presenting Keys to
the model proxy.
