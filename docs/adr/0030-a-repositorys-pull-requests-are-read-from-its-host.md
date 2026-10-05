# A repository's pull requests are read from its Git host

Date: 2026-10-05

Amends ADR 0026 (a repository's pull requests are read from the host, and a ticket still
holds its own).

## Context

ADR 0026 made a ticket carry its pull requests, and left Kira learning of a pull request
only when a webhook named a ticket. The desktop's new **Pull requests** view sits beside a
checkout and shows that checkout's repository — and a repository's pull requests are not
all a ticket's; most name no ticket at all.

## Decision

**A repository's pull requests are read live from its Git host.** The desktop asks the
server, which holds the connection, for the pull requests of the project's repository; the
server calls the host through the connection and answers. GitHub is the first provider;
GitLab, Forgejo and Gitea follow the same interface.

**The mirrored rows stay.** A ticket's pull request link is still what a webhook writes
when a hosted pull request names a ticket. The live read does not replace it: it answers a
repository's question, where the link answers a ticket's.

**The view is read-only.** Opening, editing, merging and marking ready stay on the host,
in the browser.

## Considered options

- **List only the mirrored ticket-linked rows.** Cheaper, and wrong: a pull request that
  names no ticket would be invisible, which is most of a repository's list.

## Consequences

- The server gains an outbound pull-request read per provider, behind the existing
  `gitConnection`, and needs no new secret.
- A pull request opened from a fork against an upstream cannot be resolved until Kira
  models a fork; the view shows the repository the checkout names.
- Reads happen when the view asks, not by webhook, so no realtime channel is added.
