---
name: router
description: Choose the Kira workflow skill that fits the work in front of you.
disable-model-invocation: true
---

# Kira workflow router

Use Kira's tracker as the source of truth. Tickets have acceptance criteria, dependencies and a status; Blocked is derived from open blockers. The chat's project defines which tickets Kira can access. Attachments provide context, and the person's request defines the work.

## Idea to shipped work

1. **Shape the idea** with `/to-spec`: it interviews the person and proposes the spec. Use `/domain-modeling` when the words or boundaries are unclear.
2. **Prototype** with `/prototype` when a state model or interface needs to be tried rather than debated.
3. **Map a large effort** with `/wayfinder`; resolve the map's decision tickets before building.
4. **Break the approved spec** into dependency-ordered tickets with `/to-tickets`.
5. **Build** in Build mode. For an approved spec, work its requested tickets in dependency order on one spec branch. Confirm creating or continuing that branch from `main` before changing branches or editing code. For a standalone ticket, follow the repository's branch workflow and Kira's implementation guidance.

## On-ramps

- Use `/grilling` to stress-test a question ticket or a decision.
- Use `/diagnosing-bugs` for a failure that needs a tight reproducer and regression test.
- Use `/research` for delegated reading against primary sources.
- Use `/merge-conflict` for an active merge conflict; preserve the intent of both sides and finish with the project's checks.

## Kira rules

Prefer the existing tracker over parallel records. Update requested tickets in the current project through Kira actions, attached or not: set Running when work starts to record the chat link automatically; after opening a PR, attach its HTTPS URL and set Needs review. A checkout with no remote may go to Needs review without a link. If a remote exists but publishing or opening the PR fails, leave the ticket Running and report why. Manual PR-link attachment is not available yet. A person handles Ready, Done after merge, and Won’t do. Agents cannot delete tickets or write tracker storage directly.

A small change with a project ticket can go straight to Build mode. A larger effort should pass through `/to-spec` and `/to-tickets` so each ticket has clear criteria and blockers.
