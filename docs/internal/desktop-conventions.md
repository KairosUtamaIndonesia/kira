# Desktop conventions

Scope: `apps/desktop/src/`, the Electron app — `main/` (the backend), `preload/` (the
seam), and `renderer/` (the window).

These rules exist so that new code is hard to tell apart from what is already here.
The point is not tidiness — it is that this shape gets copied, so it has to be the one
we want repeated.

## The window asks two libraries for two different things

`renderer/` draws the chat with two libraries, and each answers a different question:

- **What the chat does** is `@assistant-ui/react`: messages, branches, the composer's
  submit and disable rules, scrolling. Reach for its primitives — `ThreadPrimitive`,
  `MessagePrimitive`, `BranchPickerPrimitive` — rather than hand-rolling the behaviour
  or keeping chat state beside it.
- **What the chat looks like** is `@astryxdesign/core`: every pixel. Primitives are
  unstyled, and Astryx components go inside them (`asChild`), never the other way round.

Astryx is styled with StyleX, which compiles before it ships: `astryx.css` is its
finished output, so using Astryx means importing that CSS rather than running its
compiler, and the `@stylexjs/stylex` the app depends on is the runtime those compiled
components call into. `renderer/src/styles.css` therefore has two jobs — it is where
Astryx's entry points are imported, and it holds the panes' layout, which is structure
rather than looks: which pane is which, what scrolls, what stays put. The frame above
those panes is not ours to lay out: `AppShell` owns the nav column, its width, the main
region, the landmarks and the skip link, so anything about the shell is said with the
shell's props rather than in this file. Where no prop exists, one rule names Astryx's own
theming target for the nav panel instead — its horizontal overflow has no prop to say it
with — and that is the only reason this file should reach the shell at all. Put lengths
there in Astryx's own tokens (`var(--spacing-3)`) so the file says one step of the rhythm
rather than a number; a length that is genuinely ours is written plainly.

The nav is not the only place a prop is missing. Astryx anchors a `Selector`'s list below
its trigger and then nudges the list up by whatever it would overflow — which, at the
bottom of the window where the composer sits, lands the model list on top of the composer,
and wins over the flip Astryx also declares. So a second rule names that layer and says
which side of its trigger the list belongs on. The two rules are the same kind of thing: a
rule for a placement no prop can express, naming Astryx's own target and nothing else.

The composer is the one exception, and it is a deliberate one: Astryx's `ChatComposer`
is the whole shell — box, buttons, keyboard handling, the line errors appear on — so
`renderer/src/composer.tsx` holds it and says the runtime's composer in Astryx's words.
That file is the entire seam. One of the shell's own readings is not the runtime's and
is overridden there: it takes `isDisabled` to mean nothing can be typed, which is not
what a turn in flight means. The rest is the runtime's, said in the shell's words — are
there words to send, can this run be stopped, and what Enter and Alt+Enter each promise —
so anything else that wants to know whether a message can be sent asks that file rather
than working it out again. Stopping a turn travels the same way and in the same
direction: the runtime says a run can be stopped only once the adapter is handed a
`cancel`, and the shell's second button state is what draws it, so no caller decides for
itself whether there is something to stop.

Waiting words are the second deliberate exception, in the other direction: the runtime
offers a queue of its own — `ExternalThreadQueueAdapter` — and Kira does not use it.
That queue belongs to whoever builds it, which is why `createMessageQueue` is exported:
pending drafts live in the window, and steering means cancelling the run and saying the
words again. pi's queue is the opposite — it lives in the session, and steering means
handing words to the turn that is already running, after its current tool calls — so a
queue in the window would be a second owner of the same words, and would either lose
them when the window closes or have to be kept in step with pi's by hand. `ChatState`
carries the two lanes, and `onNew` routes on the chat's running state: waiting is pi's
job, so nothing above has to know when a queued line is read.

What crosses between the two is the tree: `preload/bridge.ts` gives every message an
`id` and a `parentId` and names the branch on screen in `headId`, which is exactly the
shape the runtime reads branches out of. Those are the runtime's words, not pi's — pi's
`session`, `entry` and `leaf` still never leave `pi/`. Keep that shape: a flat
transcript cannot grow a branch picker later.

A message's own parts are the third deliberate exception, and it is inside the window
rather than outside it. assistant-ui's message parts are what the runtime reads, and a
tool call there is an id, a name and whatever its arguments were: nothing about how the
call went. So a message is drawn from the transcript's own parts (`ChatPart`), which say
what was said and what each tool came to — whether it finished, how long it took, what it
came back with, and what an edit changed — while the runtime's copy of those parts is only
there so it knows a reply carries more than words. The primitives still own everything else about a
message: where it sits, whether it can be edited, which branch it is on.

## The workbench

The workbench is the pane beside a chat: what Kira is holding for that chat, and the files in its
workspace, open beside the conversation rather than instead of it. It belongs to one chat — two
chats working in one project show the same tree and their own open files (ADR 0015) — while how
wide it is and whether it is showing belong to the window, the way the sidebar's width already
does. Its own code sits at the renderer root beside `composer.tsx`, because it is one instance the
window owns rather than one per chat. Its layout is this file's business like any other pane's;
what it looks like is Astryx's.

Its tabs are peers in one strip, each filling the pane from the strip down. The first is Context —
what Kira is holding, which used to stand beside the conversation as a panel of its own — and the
rest are the chat's workspace and the files opened from it. A tab that is not showing keeps what it
had, so the workspace holds its expanded folders while a file is being read. The word on the tab is
Context; the code still says memory, which a rename would have to carry across the database and the
main process, so it waits for a change that is worth that.

What it may read is decided in the main process, never here. The channel takes a chat id and a
path relative to that chat's workspace, and the folder it resolves against comes from the chat's
own record — the renderer never sends an absolute path. That is a default and not a boundary,
since ADR 0001 gives Kira a terminal's reach; but a workbench that could name any path would be a
second way to read the whole disk, which is not a thing anyone asked for.

The tree is git's answer, not ours (ADR 0014), and nothing here matches `.gitignore`:

- The filtered tree is `git ls-files -co --exclude-standard`, run in the folder being listed so
  the answer is scoped to it and its paths come back relative to it. The ignored roots the reveal
  control offers are its mirror, `git ls-files -o -i
--exclude-standard --directory`, and expanding one is the same query run in that folder.
- When git cannot answer, the tree shows everything and says so; a folder holding nothing says
  that instead, since how it was filtered is not the interesting thing about an empty folder. A
  folder that is not a checkout gets no git affordance at all, not even a disabled one, and nothing
  is written into it to make it one.
- Render only the levels the reader has opened. `TreeList` does not virtualize, so the `items`
  built for it hold exactly the rows on screen — which is what keeps the walk lazy and the tree
  fast without a second dependency. Every folder row carries children from the first paint, an
  unread one included: Astryx reserves the chevron column a leaf aligns under per _tree_ rather
  than per row, so a tree of nothing but leaves sits flush and the first folder opened would shift
  every row sideways. The unread folder's one child says it has not been read, and clicking it
  reads the folder.

Directory rows come before file rows, each alphabetical and case-insensitive. The preview is
read-only — the file's text, capped in size, refusing a binary with a sentence saying so — and
nothing here edits a file. A watched file re-reads itself in place and keeps its scroll position
(ADR 0016); a file that disappears keeps its contents on screen while its tab marks that it is
gone.

A row's icon is the one thing in the tree that is not Astryx's: what kind of file it is comes from
`material-icon-theme`, bundled whole as a devDependency, with `fileIcons.ts` answering which of the
theme's names a row wants and `fileTypeIcon.tsx` drawing it. ADR 0018 has why that exception exists,
what it costs, and the limits it carries.

What Kira has changed is marked with a dot beside the file's row, and the mark is git's answer
rather than ours: `git status` for the folder being listed, joined to the rows by path, asked in
the same breath as the listing so a folder costs one status query rather than one per row. Only
files are marked — a folder is not marked for what changed under it, because the mark is about a
file. A file put back the way it was committed loses its mark, because the next answer from git
says so. Where git cannot answer, nothing is marked and the pane says which of the two it is: a
folder that is not a checkout marks nothing _and_ says git cannot answer, so a markless tree is
never read as an untouched one.

Marks arrive with the listing, so they are as fresh as the level they are on. Showing the
workspace tab again reads the folder the pane names again, which is what makes a file Kira has just
written appear marked without reopening the chat, and a folder inside it is read when it is opened
and kept after that.

The tree keeps up because the folder is watched rather than read at moments we choose — ADR 0016 has
why, and what it costs. `workspace/watching.ts` is the whole of it: Node's `fs.watch`, one watch per
level it is given, no watcher dependency, answering one call for a burst rather than one per event.
The levels are the ones the pane is showing, which is what makes opening the tab immediate — a
folder nobody has opened is not walked — and what it means to name a new one is the pane's, so it
names a folder when it is opened and names its set again whenever that set changes. What that call
means is the pane's to say, so it reads the levels it is holding again — the root and every folder
that has been opened — and never walks the tree to find what else might have changed. A change is
never applied as a path, so an event with no path, a file replaced by a folder and a folder that has
gone all take the same route: read again, because a wrong diff is worse than a redundant read. A
level that has been read is read again even if the reader has since collapsed it, because `TreeList`
does not say what is collapsed — and reading it again is what makes reopening it show what is there
now. The watch belongs to the window, one folder at a time, and is released when the tab stops
showing, when the chat changes, when the page is replaced and when the window closes. A folder the
platform will not watch is not a failure: the listing never depended on the watch, so the tree is
drawn exactly as it was and simply stops keeping up.

A file's tab shows the file's name and carries its path on its tooltip — `Tab` has no title of its
own, because Astryx keeps `title` off every component — so two open files sharing a name are told
apart by the tree rather than by the strip, a limit worth remembering before a second `index.ts`
reaches the strip. A tab is closed by the cross on it with a pointer, and by Delete or Backspace on a
tab that has focus: `Tab` renders a button, and a button inside a button is neither valid markup nor
reachable, so the cross is a span and the keyboard's way out is the key. Closing a tab shows the file
that took its place, or the workspace when it was the last, and never closes the pane; focus follows
to that tab, so a reader closing tabs with the keyboard stays in the strip.

The workbench names the folder it is showing: a project's chat shows the folder's own name, as
projects already do, and a workspace Kira made for the chat says so in words, because its own
name is a UUID. An empty folder gets a sentence rather than a blank panel, and anything that
fails is shown in the pane that failed, so a refusal never reads as an empty folder.

## Folders are kinds of code, not features

One folder per kind of code. Every file in a folder is that kind, whichever feature it
serves.

| folder       | holds                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| —            | `index.ts`, the entry: process lifecycle, windows, menu. No logic.                                                   |
| `auth/`      | the signed-in person: the device key at rest, the browser handshake, and the one module that knows the server's wire |
| `ipc/`       | the renderer seam: the channels' handlers                                                                            |
| `db/`        | persistence: owns the SQLite file, the only place SQL is written                                                     |
| `pi/`        | the agent harness: pi's SDK, and the live sessions it must dispose                                                   |
| `mcp/`       | app-level MCP server connections, child processes, status and tool calls; it never imports pi                       |
| `workspace/` | a workspace on disk: git's exclusions, one folder at a time, reading one file                                        |

Root files are single-instance modules that more than one folder needs: `memory.ts`
(what a project has worked out), `tracker.ts` (the project's queue, and the workspace's
link to it), `usage.ts` (what runs have spent).

A folder appears with its first real file. `ipc/` exists when the first channel does,
not before.

When a file fits no folder, that is a new **kind** of code: name the kind, then add the
folder. A feature never gets its own folder, and files never go into a catch-all — there
is no `utils/`, `lib/`, `helpers/`, `services/`, `core/`, or `types/`.

## Imports point one way

```
index.ts  →  ipc/ · db/ · pi/ · mcp/ · workspace/  →  node:sqlite, pi, git, the disk
pi/       →  mcp/  (type-only bridge; mcp/ never imports pi/)
```

`db/` and `pi/` know nothing about `ipc/`. `ipc/` never imports `pi/`: its types cross
into the renderer, and pi's vocabulary must not. Only `index.ts` imports `electron`.

`workspace/` is the disk itself — listing a folder and reading a file — and `ipc/`
imports it the way it imports anything else it needs: it does not, it is handed it.
The channel handlers take a workspace as a dependency, so what the window may read is
decided at the seam and the git calls stay in one folder.

Modules take what they need as arguments instead of constructing it, so a test crosses
the same seam the app does. The folder picker is the clearest case: `ipc/workspaces.ts`
asks a `chooseFolder` it was handed rather than reaching for `dialog` itself, which is
why `ipc/` still knows no electron — and why the case that matters most, a picker
closed without choosing, is one a test can reach.

**The pi rule, precisely: pi is imported at runtime only in `pi/`.** The `entries` table
stores pi's entry format verbatim, so `db/threads.ts` imports pi's `FileEntry` _type_ —
types cross, runtime imports do not.

**The preload reaches main through one file.** `src/preload/bridge.ts` holds what both
sides of the renderer seam need — the wire types and the channel names — and the preload
and `ipc/` both import it, so neither imports the other. Nothing in `preload/` imports
`main/`.

## Naming

- Functions are verbs: `createThread`, `openThread`, `reconcile`.
- Types are nouns: `Thread`, `PiThread`.
- A file is named for what it holds: `storage.ts`, not `session.ts`, `manager.ts`, or
  `helpers.ts`.
- One word means one thing everywhere.
- pi's identifiers stay inside the code that adapts to pi. Anything a user reads or the
  renderer receives uses Kira's words.

## Tests

Colocated — `storage.ts` next to `storage.test.ts`. Table-driven: one test function fed
named cases, asserting exact output and error.

Any test that boots pi points `HOME` and `PI_CODING_AGENT_DIR` at fresh temp directories,
so it never reads the developer's real agent directory.

## Unsettled

Do not invent an answer to these in passing; they are decisions, not details.

- **One user-facing word for "conversation"** is provisional. The chat surface calls it a
  "chat": `preload/bridge.ts`, the `chat:*` channels and their handlers, and the renderer.
  `db/` and `pi/` keep calling the stored thing a thread, so the word the user reads never
  turns into pi's "session". It is picked, not decided.
