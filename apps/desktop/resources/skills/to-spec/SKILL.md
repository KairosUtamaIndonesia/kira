---
name: to-spec
description: Shape a concrete feature or change into a Kira spec. Interview the person in chat, then propose the spec with shape_spec_proposal.
---

Turn a feature or change the person wants built into a spec proposal. The interview happens in the chat, one question at a time. The spec reaches the tracker only when the person approves the proposal card.

## 1. Ground

Read the project's words and history before the first question: `tracker_read_glossary`, `tracker_read_decisions`, `tracker_queue`, and the code the request touches. Looking up facts is your job; decisions belong to the person. Use the glossary's terms in every question.

Done when you know which tickets, Decisions and code the request touches.

## 2. Interview

Interview with the `grilling` skill's method. Find out:

- **Problem**: what goes wrong today, in the person's words.
- **Audience**: who hits the problem, and when.
- **Outcome**: the observable behavior that shows it is solved.
- **Boundaries**: constraints, and nearby work deliberately left out.

This is what to learn, not a script: skip what the conversation already settled and follow a branch an answer opens. Use `domain-modeling` when a word is doing two jobs. When the answers show the idea is too large for one spec, switch to `wayfinder`.

Settled when you can state the problem, audience, outcome and boundaries without guessing, and the person has no open objection.

## 3. Propose

Call `shape_spec_proposal`:

- **problem**: the person's problem and who has it.
- **solution**: the behavior they will receive, its boundaries and what is out of scope, the contracts it must keep, and the highest existing seam where tests can prove it.
- **stories**: user stories covering the complete surface, each one observable.
- **mapTicketId**: the map ticket, when this spec is a map's destination.

The approval card appears on its own. End your turn and wait for the person. When they ask for changes, revise and call `shape_spec_proposal` again. Their Approve writes the spec ticket; the next stage is `to-tickets`.
