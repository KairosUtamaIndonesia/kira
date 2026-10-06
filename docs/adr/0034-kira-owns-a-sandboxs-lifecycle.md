# Kira owns a sandbox's lifecycle

Date: 2026-10-06

Follows ADR 0031, 0032 and 0033.

## Context

CubeSandbox (the sandbox backend) measures idleness by proxied HTTP requests, so a runner busy working looks idle to it. A paused sandbox keeps its disk and drops the runner's open outbound sockets; a killed one loses its disk; a node loss kills running sandboxes. The GitHub token (ADR 0032) lasts an hour.

## Decision

**Kira, not Cube, decides when a sandbox pauses and ends.** Sandboxes are created with `timeout=-1`.

- **Pause:** the server pauses a sandbox about ten minutes after a turn settles and the runner has flushed (ADR 0033). A queued command makes the server resume it (`connect`); the runner's long-poll reopens by itself.
- **End:** the person closes the chat, or it has been paused for seven days. Ending kills the sandbox and revokes its Kira key and GitHub token. Ticket status does not end a sandbox. There is no maximum lifetime.
- **Image:** one Kira template (Node, bun, git, ripgrep, pi's config-dir patch). A project's setup is `.kira/setup.sh` in its repository, run once in each fresh sandbox after the clone, including after recovery and not on resume. A failure is shown in the chat and the chat starts anyway. There are no snapshots or dependency caches.
- **GitHub token:** the server mints a new one and sends the complete network policy (`PUT /network` replaces it) on every resume and about every 45 minutes while running.
- **Node loss:** the desktop shows that the sandbox was lost and unpushed work is gone. The next command creates a fresh sandbox, re-clones, checks out the ticket branch and reloads the transcript from the server.

## Known limits

- A paused sandbox still holds node quota and disk equal to its dirty memory. Revisit when that limits the number of chats.
- Every fresh sandbox pays clone and setup time. Snapshots or caches are the revisit if that hurts.
- Only pushed work survives a node loss.
