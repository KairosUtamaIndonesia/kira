# Spec, map, question and research are kinds

Date: 2026-09-23

Amends ADR 0011 and ADR 0017.

## Context

ADR 0017 keeps one object: a spec and a map are shapes of a ticket's body, and a child blocks
its parent. That still holds. However, a shape is not something the product can read. A spec
written a minute ago has no children yet, so nothing tells it apart from a feature, and a Specs
view or a spec's page has nothing to select on. A map's children are also not all alike: some
are a conversation with a person, and some are reading a run can do alone.

A decision's answer also now has two homes. A ticket settles a question, and a project commits
to a Decision (ADR 0020). Both were called "decision".

## Decision

**The kinds are prototype, bug, feature, refactor, question, research, spec and map.** Kind is
still set when a ticket is written and still decides what it owes.

| Kind     | What it owes                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------- |
| question | an Outcome, settled with a person in a chat (`ready-for-human`); may propose a Decision        |
| research | an Outcome with its sources, from a run working alone                                          |
| spec     | the integration pass: every child's criteria checked together, the suite, a review vs the spec |
| map      | nothing run; the way is clear when no question under it is open                                |

The `decision` kind becomes `question`, and "Decision" now names the project's record.

**A spec with no children is never Ready.** It reads Blocked, waiting for its tickets, so its
integration pass cannot start before there is anything to integrate.

**A map's destination is a spec**, which becomes the map's last child.

**A closed question or research ticket carries its Outcome**: the answer, and where the longer
reasoning lives. A map reads its closed children's outcomes as its decisions so far.

## Consequences

**"Part of" and "waits for" still share one relation.** A slice that waits for another reads as
that slice's child. Kira gates a spec on every one of its tickets directly, so a spec's
children are exactly its tickets.

**Existing `decision` tickets are migrated to `question`.**
