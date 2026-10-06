# A sandbox chat's agent loop runs in its sandbox, brokered by the server

Date: 2026-10-06

Amends ADR 0012 (its revisit clause: "if a remote sandbox ever exists"). Sits beside ADR 0024, which still holds: a sandbox chat is an ordinary chat, and there is no worker, claim or lease.

## Context

A **sandbox** is a remote, isolated environment a chat works in, instead of a folder on the person's machine (CONTEXT.md). The destination of the sandbox effort requires that a sandbox chat can keep working while the desktop is closed. The backend is CubeSandbox, self-hosted, with an E2B-compatible API (`docs/internal/research/cubesandbox.md`).

pi lets a chat's tools be redirected to a remote executor, so the loop could stay on the desktop with only the tools remote. That shape ends when the laptop closes, and pi's `grep` cannot be redirected in 0.85 (it spawns `rg` locally). The survey of Kira's agent code found that nothing under `apps/desktop/src/main/pi/` imports Electron, and that all ten `ChatEvent` types are already plain JSON that crosses Electron IPC. Every product studied keeps the transcript and the real provider credential outside the sandbox (`docs/internal/research/cloud-agent-prior-art.md`).

## Decision

**The agent loop of a sandbox chat runs inside its sandbox, from the first iteration.** There is no "tools remote, desktop must stay open" stepping stone.

**What runs there is a Kira runner, not stock pi.** A small headless runner embeds the pi SDK and reuses Kira's own session boot, extension and conversation mapping. `pi --mode rpc` was rejected: it would force `kiraExtension` into a standalone file, lose branch switching and message editing, and bypass `conversations.ts`.

**The agent code moves into a shared package first.** `packages/agent` is extracted from `apps/desktop/src/main/pi/` as a behaviour-preserving refactor that ships before any sandbox code exists. The desktop imports it back. The runner never imports from the desktop's source tree, so a later change to that folder cannot pull Electron into the sandbox.

**The Kira server brokers everything.** The desktop never reaches the sandbox. The server holds the Cube client, maps a person's chat to its sandbox, and issues the key the sandbox's model traffic uses. CubeProxy and Cube's admin key stay on a private network.

**The desktop shows a sandbox chat through a second `Conversation` implementation.** It mirrors the `ChatEvent`s the sandbox's own conversation emits, so the renderer and `openChats` are unchanged. Forwarding `ChatEvent`s whole is the first version; the whole-transcript events grow quadratically over HTTPS, and streaming raw entries is the known next step.

**A sandbox chat's first tool set leaves out the browser tools and MCP.** The browser tools need a window on the desktop and MCP servers run on the person's own machine with local secrets. Subagents inside a sandbox are deferred.

## Considered options

- **Tools remote, loop on the desktop.** Cheapest to start, and it leaves `Conversation`, the model key and the SQLite transcript untouched. Rejected: it stops when the laptop closes, which the destination does not allow, and it would leave two code paths to keep.
- **Stock `pi --mode rpc` in the sandbox.** Rejected for the reasons above.
- **The desktop connects to the sandbox directly.** Fewer server parts. Rejected: the data plane and the admin key would have to be reachable from laptops.
- **The runner imports the desktop's source.** No refactor. Rejected as above.

## Consequences

- **The server gains a durable copy of a sandbox chat and a way to push to the desktop.** It has no transcript store and no realtime channel today. What is stored, who is authoritative while the sandbox is alive, and how a chat resumes in a fresh sandbox are open (transcript and steering ticket on the map).
- **The sandbox runs Node.** The runner uses `node:sqlite` for a sandbox-local `ThreadStore`; Bun's support for it is unverified.
- **Browser and MCP tools are not available in a sandbox chat**, so a ticket that needs `verify` against the desktop app cannot be cleared there yet.
- **ADR 0012's revisit clause is answered.** The desktop stops being the only place a chat's loop runs, and the server is now a broker rather than only a queue and a model proxy. ADR 0024's rules about tickets and status hold unchanged.
- **ADR 0001 is reopened for sandboxes** and is the subject of the trust-boundary ticket on the map.

## Sources

`docs/internal/research/cubesandbox.md`, `docs/internal/research/cloud-agent-prior-art.md`, `docs/internal/research/remote-sandbox-providers.md`; pi `docs/extensions.md` "Remote Execution"; Kira: `apps/desktop/src/main/pi/agent.ts`, `conversations.ts`, `storage.ts`, `extension/factory.ts`; map: https://github.com/KairosUtamaIndonesia/kira/issues/166.
