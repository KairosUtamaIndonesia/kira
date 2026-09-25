# Accepting a slice merges it into its spec's branch

Date: 2026-09-23

## Context

ADR 0010 and the glossary say accepting a run is a verdict rather than a merge: nothing a run
produces lands on its own. Live, that meant an accepted ticket went back to Ready rather than
Done, and a run always started from the project's HEAD.

That holds while a person runs one ticket at a time and lands each branch by hand. It breaks
once a spec's tickets are run as a frontier. Slice B waits for slice A, but B's run starts from
HEAD and does not contain A's work. B also only unblocks when A is Done, and accepting A did
not make it Done.

## Decision

**Accepting a run closes its ticket as Done.** Sending it back leaves the ticket open.

**A spec has a branch of its own, pushed to the project's remote.** Each of its tickets' runs
starts from the spec branch. Accepting a slice merges that run's branch into the spec branch
and pushes it, so the next slice starts with everything accepted before it, from any of the
person's workspaces.

**A merge that conflicts refuses the accept.** The ticket stays in Needs you with the reason,
and its panel offers **Resolve with Kira**: a run on the same ticket that brings its branch up
to date with the spec branch. That run's proposal is then accepted in the usual way.

**Nothing reaches the main line without a person.** The spec's own run is the integration pass
on the spec branch. Accepting it closes the spec. A person then opens and merges the pull
request in their git host, so Foundry holds no host-specific code and no host credential.

**A ticket outside a spec** closes on accept and keeps its branch. A person lands it.

## Considered options

- **A person merges each slice into main.** This keeps "accepting is a verdict", but Run what's
  ready would stall on a human merge at every step.
- **Stack each run on its gate's branch.** A slice with two gates has no single base, and the
  stack still has to be landed by hand.
- **Foundry opens the pull request.** Friendlier, but it is host-specific and needs the
  person's host credentials. This can be revisited once the spec branch works.

## Consequences

**The desktop pushes.** A run's workspace needs push access to the project's remote. A desktop
that cannot push cannot accept a slice, and it says so before the run starts.

**The claim and run rules are unchanged.** Merging happens at the accept boundary. That is a
person's press, not a run's.
