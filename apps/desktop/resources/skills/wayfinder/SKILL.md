---
name: wayfinder
description: Chart a large Kira effort as decision tickets until the route to a spec is clear.
---

A loose idea can be too large for one run and still too vague to split into build work. Wayfinding charts the route instead of charging toward it. The shared map is a Kira map ticket with child decision tickets; its decisions are resolved one at a time until the way is clear.

## Map contents

- **Destination** — the outcome the project wants.
- **Notes** — constraints, standing preferences and skills needed.
- **Decisions so far** — one line per resolved decision, with the ticket that explains it.
- **Not yet specified** — the remaining fog, written plainly without pretending it is already a ticket.

Decision tickets are `question` or `research` tickets, the only children a map takes. A question settles a human decision through `grilling`; research gathers facts. When a question needs a design made concrete before the person can decide, answer it with `prototype`.

## Process

1. Name the destination and the uncertainty blocking it.
2. Grill the destination with the `grilling` method until the open decisions are named.
3. Propose the map and its question and research children with `propose_map`, then end your turn and wait; the person's approval creates them.
4. Work one unblocked child at a time. Propose its answer with `propose_outcome`, attaching a Decision proposal when the answer is durable, and wait for the approval card.
5. When the map has no unresolved decisions, hand off to `/to-spec`, then `/to-tickets` and `/implement`.

If the whole effort is already clear and small enough for one run, skip wayfinding and implement it directly. A map produces decisions, not a disguised build queue.
