# A project's glossary and decisions live in Kira

Date: 2026-09-23

## Context

The skills keep a project's language in a `CONTEXT.md` and its decisions as ADRs under
`docs/adr/`, both in the repository. ADR 0010 settles that a project is not a repository: it is
worked from many folders and may span more than one repository. A glossary in one checkout
belongs to that checkout, and a run in another workspace, or another person's interview, does
not see it until someone commits and pulls.

## Decision

**A project's Glossary and its Decisions are held by the server, on the project.** Neither
lives in a repository.

**Kira writes the glossary directly.** An interview sharpens terms as they settle, which is
what the domain-modeling skill asks for. Every change keeps who made it and in which chat, and a
person can undo it.

**Kira proposes a Decision, and a person approves it.** A decision binds work nobody has written
yet, so it enters the project the way tickets do: through a press. Superseding a decision works
the same way.

**Runs read them through tools and the brief.** Kira and runs get read tools for the glossary
and the decisions. A run's brief carries the glossary and the decisions its spec cites.

**Projects start empty.** Existing `CONTEXT.md` files and ADRs are not imported.

## Consequences

**Agents outside Kira do not see them.** Claude Code or Codex in a checkout find no
`CONTEXT.md` unless an export is added later. Revisit if that turns out to matter.

**Kira's own repository keeps its `CONTEXT.md` and `docs/adr/` until Kira is its own
tracker.** They describe how Kira is built, and this repository is still worked from GitHub.
