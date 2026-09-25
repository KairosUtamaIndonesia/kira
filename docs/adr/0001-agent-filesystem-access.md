# Agent tools have full access to the user's machine

Date: 2026-09-16

## Context

Kira runs in the Electron main process and drives pi's built-in tools: `read`,
`write`, `edit`, `bash`, `grep`, `find`, `ls`. Kira gives every thread a
working directory — a project folder the user added, or a folder the app created
for a new chat — which reads as a "space" the agent operates within.

That framing implies a boundary. There is not one. The tools resolve paths
against the working directory by default but place no restriction on where they
may read or write, so Kira can reach anything the Electron process can, which is
the user's whole account.

## Decision

Kira has the same filesystem reach as a terminal running in the working
directory. Kira does not confine it, and does not claim to.

Specifically, we are not building:

- Path validation in the tools. It is a large surface, easy to get subtly wrong,
  and a boundary that leaks is worse than a stated absence of one.
- An OS sandbox around the main process. pi assumes ordinary filesystem access,
  and the app's own storage lives outside the working directory.
- Approval gates on writes. This is the likely destination, but it is a product
  feature with UI consequences, not a line in the storage layer.

## Consequences

The working directory is a convention, not a sandbox. It sets defaults and gives
the agent and the user a shared place to work; it protects nothing.

Because this is stated plainly, the safety story has to be carried elsewhere:

- Tool calls are visible in the transcript, so writes are attributable.
- The UI must not describe the working folder as a safe or contained area. Wording
  like "living space" is fine as a metaphor; anything that reads as "Kira cannot
  touch the rest of your machine" is not.
- A thread with no work to do outside its folder is still exposed to whatever the
  model decides to run, including through `bash`.

## Revisit when

Skills or threads become shareable. A shared skill is instructions the agent will
follow later, which turns remote content into a path to local execution — the
first condition under which the absence of a boundary stops being only the user's
own risk. Approval gates on writes outside the working directory are the next
step at that point.
