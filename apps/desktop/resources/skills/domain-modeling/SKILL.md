---
name: domain-modeling
description: Sharpen Foundry's project language and record durable domain decisions.
---

# Domain modeling

Build and sharpen the project's domain model while designing. Challenge overloaded terms, propose a precise canonical word, and test relationships with concrete edge cases. Use the glossary and existing Decisions as the project's language; surface contradictions between them and the code.

## Context and Decisions

Keep the project glossary focused on terms and relationships, not implementation details. Add or sharpen a term with `tracker_update_glossary`, which records the author and originating chat. Offer a Decision only when the choice is hard to reverse, surprising without context, and the result of a real trade-off. A person approves a Decision proposal; the agent does not create or supersede one directly.

## Working loop

1. Find the nearest glossary entry, ticket, spec or Decision.
2. State the ambiguity and the concrete scenario that distinguishes the choices.
3. Recommend a canonical term and, once the person agrees, record it with `tracker_update_glossary`.
4. For a Decision, call `propose_decision` with the rejected alternatives and consequences, then end your turn and wait; the person's Approve records it.
5. Reference the approved term or Decision from later work.

The glossary is not a spec, a task list or a transcript. Keep each resolved term in one authoritative place.
