# Kira bundles its skills, and Kira picks them

Date: 2026-09-23

## Context

The workflow Kira's tickets were modelled on (ADR 0017) lives in skills: grilling, to-spec,
to-tickets, wayfinder, implement and the rest. Today they ship only as files in this repository.
They reach Kira only when she happens to be working in a checkout of it. They also tell her to
use `gh`, labels, `.scratch/` and pull requests, none of which apply once tickets live in
Kira. Kira has no tracker tools and no instructions of her own.

## Decision

**Kira ships its own trimmed set of skills inside the app.** It loads them through its Pi
extension. Passages about other trackers, labels, local markdown and pull requests are replaced
by Kira's tools. `setup-matt-pocock-skills`, `triage` and `implement-spec` are dropped:
Kira is the setup, readiness replaces labels, and Run what's ready replaces orchestrating a
spec by hand.

**Kira picks the skill, and a person never names one.** Kira's extension puts the router
in her system prompt on every turn, so she always knows the stages and which skill each one
wants, and she loads it herself. A run is the exception: its kind decides what it owes
(ADR 0011), so its brief names the kind's skill.

| Stage (router guidance)             | Skill                          |
| ----------------------------------- | ------------------------------ |
| any chat, offering to shape an idea | the router (ask-matt, trimmed) |
| interview                           | grilling + domain-modeling     |
| interview confirmed                 | to-spec                        |
| spec approved                       | to-tickets                     |
| an idea too big for one spec        | wayfinder                      |
| a question ticket                   | grilling                       |
| a research run                      | research                       |
| a prototype run                     | prototype                      |
| a feature or refactor run           | implement (tdd, code-review)   |
| a bug run                           | diagnosing-bugs                |
| a spec's own run                    | code-review against the spec   |
| Resolve with Kira                   | resolving-merge-conflicts      |

**Kira's tracker tools write drafts only.** Publishing a breakdown, approving a spec, approving
a Decision, and marking tickets ready are presses a person makes on cards Kira proposes. The
approvals are therefore enforced by the product rather than by the model having asked, which
is why choosing a skill can be left to the model: no skill can publish anything. Every tool is
available in every chat for the same reason.

**A workspace's own `.agents/skills` still load** beside the bundled set. A project cannot
change the bundled skills in the first version.

## Considered options

- **Copy the repository's skills unchanged.** They would instruct Kira to use trackers Kira
  replaces.
- **Write the whole workflow into Kira's system prompt.** The procedures would stop being
  editable prose that can be tested one at a time. Only the router goes there.
- **Kira injects the stage's skill each turn.** Deterministic, but Kira stops being the one
  deciding, and a conversation that drifts between stages needs Kira to guess which it is
  in.
