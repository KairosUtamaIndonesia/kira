# The workbench watches the folder it shows

Date: 2026-09-21

## Context

Kira writes to the chat's workspace while the chat runs, and the Workbench sits beside that chat
showing the same files. Reading the folder only at chosen moments — when the panel opens, when a
turn settles — would leave a tree knowingly behind the conversation next to it, and a tab whose
contents the agent has already replaced.

## Decision

**The workbench watches the folder and re-lists what is on screen.** The watch is Node's own
`fs.watch`, one per level the pane is showing — the root, and every folder that has been opened —
debounced, re-listing only those levels. An open tab re-reads its file when that file changes and
keeps its scroll position. A file that disappears leaves its contents on screen with the tab marked,
because a file vanishing mid-read is exactly when you want to see what it said.

**It watches the levels it shows rather than the whole folder recursively**, which is this record's
own title taken literally. `fs.watch(folder, { recursive: true })` walks the tree and registers a
watch per directory before it returns, and it does that on the main process's own thread: measured
on a workspace of 17,493 directories — 16,315 of them under an ignored `node_modules` — it took 3.7
seconds, during which every IPC queued behind it, the listing of the tree included. Opening the tab
hung for about eight seconds because of it. Naming the levels costs one watch each and returns at
once, and the pane names a folder when it is opened, so nothing on screen goes unwatched.

**Foundry takes on no watcher dependency for this.** `@parcel/watcher` would buy throttling worth
about ten lines, at the cost of a C++ prebuild and the `asarUnpack` decision that comes with it.
`chokidar` is the same trade worse: it still sits on `fs.watch` and inherits every limit below,
removing only the event-shape work. Recursive watching has been supported on Linux since Node
19.1.0, and the Electron 44 build here carries Node 24.

## Consequences

**Everything the platform does not promise has to be treated as "re-list everything" rather than
applied as a diff.** A watch follows the inode, so a folder replaced by a fresh checkout stops
reporting; on Windows a moved watched directory reports nothing and a deleted one reports
`EPERM`; `filename` in the callback is not always supplied; and watching is unreliable on network
filesystems. The debounce and the re-list are the same code path as the initial load, which is
what makes it cheap to be liberal about all four.

**Watching is why this feature looked like it needed a dependency at all**, and the answer turned
out to be no: the tree, the reveal control and the refresh are git and `node:fs` between them
(ADR 0014).

**Revisit if** the raw events prove unusable in practice — a workspace on a network share, or
churn inside `.git/` during a run — at which point `chokidar` is the swap rather than a redesign.

**Measured when it was built.** With the tree showing, the Electron main process held 12 inotify
watches: the root, and the one folder that had been opened. The recursive watch it replaced held
132,173 for the same folder, and replacing the page released either. The count that matters is the
one a machine allows — 524,288 here, and 8,192 on many — and a watch that cannot be made is not a
failure: the tree still lists correctly, because the listing never depended on the watch, and simply
stops keeping up. One change produced one event, twenty files written at once produced one event
rather than twenty, and a run that writes without pausing was answered within a second, so the
gathering is doing the work the events would otherwise cost — including for `git status` refreshing
its index inside `.git/` while a folder is being read.
