---
name: router
description: Choose the Foundry workflow skill that fits the work in front of you.
disable-model-invocation: true
---

# Foundry workflow router

Use Foundry's tracker and run surfaces as the source of truth. A ticket has a kind, acceptance criteria, dependencies and a current band; a run is the conversation that works on one ticket. Keep proposals and decisions in the linked chat until the person approves them.

## Idea to shipped work

1. **Shape the idea** with `/to-spec`: it interviews the person and proposes the spec. Use `/domain-modeling` when the words or boundaries are unclear.
2. **Prototype** with `/prototype` when a state model or interface needs to be tried rather than debated.
3. **Map a large effort** with `/wayfinder`; resolve the map's decision tickets before building.
4. **Break the approved spec** into dependency-ordered tickets with `/to-tickets`.
5. **Build one ticket** with `/implement`. The run should drive tests, typechecks and the ticket's acceptance criteria.

## On-ramps

- Use `/grilling` to stress-test a question ticket or a decision.
- Use `/diagnosing-bugs` for a failure that needs a tight reproducer and regression test.
- Use `/research` for delegated reading against primary sources.
- Use `/merge-conflict` for an active merge conflict; preserve the intent of both sides and finish with the project's checks.

## Foundry rules

Prefer the existing tracker and Work surface over new files or parallel records. Let the server own ticket bands, dependencies, readiness, runs and Outcomes. Do not claim a ticket is ready, publish a proposal, approve an Outcome or close work by editing storage directly; use the corresponding Foundry action and its refusal text.

A small, single-session change can go straight to `/implement`. A multi-session change should pass through `/to-spec` and `/to-tickets` so every run has a bounded ticket and explicit blockers.
