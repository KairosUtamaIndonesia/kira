# A sandbox chat's transcript lives on the server, and the runner dials out

Date: 2026-10-06

Follows ADR 0031 (the loop runs in the sandbox) and ADR 0032 (the sandbox holds no credentials). Replaces ADR 0031's sandbox-local `node:sqlite` store.

## Context

A sandbox chat keeps working while the desktop is closed (ADR 0031), so the desktop cannot be the place its transcript lives. Today chats exist only in the desktop's local SQLite (`threads.db`); the server has no chat table and no realtime channel, and assumes one process. A sandbox is also disposable: losing a Cube node loses the sandbox's disk.

## Decision

**The runner always dials out.** It POSTs its events to the server and long-polls the server for commands. The server never connects into a sandbox to talk to the runner, so a server restart loses nothing and nothing depends on envd reconnecting. (Waking a paused sandbox is the server's lifecycle job.)

**Postgres on the server is the only durable copy.** The runner keeps a chat's entries in memory and upserts each one keyed `(chat, entry id)`, together with the row state that lives outside entries (`headId`, model, mode, ticket ids). It flushes on `agent_settled` and every few seconds. Resuming in a fresh sandbox reloads from the server. There is no sandbox-local database. Observations and reflections are not stored; they are recomputed on open, as the desktop does today.

**The transcript is the person's.** Sandbox chats are listed per person and read from the server on any machine they sign in on. The desktop keeps no local copy; `threads.db` stays local-only.

**The desktop follows over server-sent events.** The first message on the stream is the chat's latest `ChatState` snapshot, a `jsonb` the runner flushes with the entries and the desktop uses only for display. After that the server relays the runner's `ChatEvent`s. Token deltas are relayed and never stored; after a dropped stream the desktop reconnects and gets the snapshot again.

**Commands are durable rows.** Send, steer, stop, take-back, branch switch, edit and model or mode changes are small Postgres rows the runner long-polls and acknowledges, so a send is not lost if the server restarts. Take-back waits a few seconds for the runner's acknowledgement carrying the lines, and otherwise the desktop shows that the lines already started.

**A stale runner cannot write.** The per-sandbox key (ADR 0032) is revoked when its sandbox ends, and the server checks that the chat belongs to the key's person.

## Known limits

- **A runner crash can lose the last few seconds of entries**; the chat resumes from the last flush.
- **One server instance.** The stream's fan-out is in-process, like the pool's concurrency cap. A second instance needs `LISTEN/NOTIFY` or polling first.
- **State events carry the whole transcript**, so cost grows with a chat's length (ADR 0031). Streaming entries instead is the known next step.
- **A sandbox chat cannot be read offline.**

## Consequences

- The server gains a chat table (entries, row state, snapshot, commands) and routes for events in, commands out, listing and the stream.
- ADR 0031's Node note narrows: the runner no longer needs `node:sqlite`, so the Bun question there falls away. The runner needs a store that implements `ThreadStore` in memory, which `packages/agent` must expose as an interface.
- The desktop's second `Conversation` implementation is a thin client of these routes.
