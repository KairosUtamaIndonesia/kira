# Changelog

## [Unreleased]

### Changed

- Ask user questionnaires use compact question tabs with Review last, reveal the write-in field only when selected, collect an optional note once in Review, and use the transcript's body type size throughout.

### Fixed

- A GitHub App install link expires an hour after Kira hands it out, and uninstalling the App on GitHub removes its connection, so Settings cannot keep a host GitHub no longer backs.

- Bundled workflow skills load correctly in the compiled development desktop, including chats in empty workspace folders.

### Added

- A chat's workbench gains a **Changes** view over its own checkout: what changed as one file list with each file's added and removed lines and whether it is staged; a review that gives a file's diff the whole pane and steps through the files (`j`, `k`, and `s` to stage and move on), inline or side by side; staging a file or a single hunk; commits ahead of and behind the upstream on the branch row; a commit message and commit; reverting a file; the branch list and switching; the commit history with the files each commit changed; and fetch, pull and push shown in git's own words. Every index write is serialised per checkout, so it never interleaves with the file tree's status reads.

- A chat's workbench gains a **Pull requests** view: the checkout repository's pull requests read live from its connected Git host, each row showing its title, branch, state, checks rollup and age. Opening one reads it read-only across About, Files and Checks, and a changed file opens into the whole pane with its diff, stepped through with `j` and `k` like the Changes view. See [ADR 0030](docs/adr/0030-a-repositorys-pull-requests-are-read-from-its-host.md).

- Attaching a repository to a project can pick from the repositories the connected GitHub App can see, instead of typing the owner and name by hand.

- Chats can delegate bounded work to child agents, track live progress in the composer and Workbench, inspect child transcripts, and stop, steer, or resume children. Read-only children share the chat folder; write-capable children receive an isolated checkout. Child model requests share the person's usage ledger and are capped for concurrent work.

- A project can hold its own skills. A skill is a name, a description, the instructions it works by, and any reference files that travel with it; Kira writes them into the folder a chat works in, so every chat in the project can use them beside the workflow skills she ships with. See [ADR 0027](docs/adr/0027-project-skills-live-in-the-store.md).

- Kira can write and change a project's skills herself, and a person can write one in **Work → Skills** beside the project's repositories. A skill Kira writes is noted in the chat it was written from, with a Delete offered where she created it rather than changed it.

- A ticket is corrected where it is read: its title, its description, and the checks it is done when are edited in place and saved when you leave the field, instead of through a separate edit form. A new check is a blank row that says nothing until you type in it, and removing one is offered on the row itself.

- The composer's four leading characters are live: `@` searches this chat's workspace files and inserts a readable path reference, `/` lists the commands and skills the chat's session supports, `#` expands a shared Magic Prompt into the draft, and a leading `!` runs the rest of the draft as a local command. The composer's placeholder names all four. See [the composer guide](docs/composer.md).

- Magic Prompts are reusable text shared across every project on this installation: save them in **Settings → Magic Prompts**, search them after `#`, and edit the expanded text before sending. Choosing one never sends it for you.

- A leading `!` in the composer runs a local command in the chat's working folder without starting an AI turn. The output streams while it runs and is kept in the chat as context Kira can read, with a Run action, a Cancel command action, and no model call or allowance spend. Finished commands appear inline on the transcript surface, with output collapsed under the command and status. One command runs per chat at a time.

- The chat rail shows how long Kira has been working in each running chat, ticking once a second in the status dot's blue. Workspace headings no longer show chat counts.

- The chat rail is a ledger: each workspace is a ruled section, chats are single rows with a short age, and a workspace's Work, new chat and menu appear when you point at its name, so a project's Work is one click away. The rail now shares the chat's ground, the chat you are in is marked with a small red dot instead of a red block, and the account row at the bottom lines up with the chats above it.

- Kira admins can inspect live shared provider Credential health, add Codex and Claude logins through a remote-safe OAuth flow, and manage Credentials from the console. Per-user Allowances remain separate from provider health; management changes are audited without storing credentials or OAuth callback URLs.

- Approving a spec or its tickets in a chat that isn't in a project now asks where it should live, instead of refusing: choose a folder that is already in a project, or start a new project in a folder you pick. The chat moves to that folder and keeps its history. A chat can also be moved from its row's menu ("Move to project…"), and leaving the dialog changes nothing.

- Work's wording is clearer and consistent: tickets, blockers, chats, and project folders are named the same way everywhere, and refusals such as two tickets blocking each other say what to do next.

- Work opens with a project chooser and a ruled board grouped by the six stored ticket statuses, with Blocked shown when a blocker is open. Moving a ticket changes its stored status; moving it to or from Blocked edits blocker links.

- Work's search has a magnifier, a clear button, and `/` to jump into it. Filter is a menu of Status, Kind (with icons), and Assignee; active filters show as removable chips, and Display sets grouping, order, and whether Done and Won’t do tickets show.

- New ticket opens as a dialog with a rich markdown editor for its description.

- The List view is a table with a pinned column heading, foldable status or kind groups, and the same drag-and-drop as the board; a ticket's drawer opens beside it.

- A ticket's drawer can expand into a full view: the ticket reads as a document, with its status actions, facts, blockers, and linked chats in a box that stays beside it while the document scrolls.

- Work is a ticket store. Kira works requested tickets in the chat's current project with the skill for each kind, attached or not. Agent-created tickets start as Draft; status changes are limited to Running and Needs review. Starting work records the chat link automatically; reading or editing ordinary fields does not. Other projects and person-owned approval actions remain protected. Kira cannot delete or close tickets. Pull-request review and merge happen on GitHub, and a person marks a ticket Done afterward.

- Tickets can show one current **Open pull request** link. Kira attaches it after opening a PR; with no remote, it can set Needs review without one, while a remote that cannot publish or open a PR leaves the ticket Running.

- Kira's desktop now runs on Electron, with its own Bun-powered platform API and administration console.
- Packaged desktop builds check for updates automatically, download them in the background, and offer a restart to install from Settings. macOS, Windows, and Linux AppImage are supported.

- Users on Windows, macOS, and Linux can choose and test Kira's Bash-compatible executable from Settings. The saved device-local preference takes effect in open chats on their next command, and `$SHELL` in those commands matches the selected executable without changing the login shell. See [the shell setup guide](docs/custom-shell.md).

- Ticket work history is separate from composer attachments. Starting work no longer adds a context chip, and removing context keeps the ticket's linked chat. Existing ticket links are retained while old composer attachments are cleared.

- Chat now shows an open work trace as soon as a turn starts, updates it with live reasoning and tool activity, and gathers the turn's work into one group until the answer begins.

- Kira can ask up to four structured questions in an inline chat card, with custom or partial answers, multi-select previews, per-question and shared notes, and cancellation.

- After approving a spec, Kira routes natural requests to make tickets through the bundled breakdown workflow. Kira validates proposals before showing the approval card; published drafts whose readiness was refused can be corrected and readied again without publishing a second breakdown.
- Chats can switch between Build, the default mode with workspace tools, and Spec, a planning mode with read-only tools. In Spec mode, approving a spec immediately prompts Kira to propose its ticket breakdown; the person approves that separately, then opens individual tickets in Work.
- The workbench now has a persistent embedded browser with safe HTTP(S) navigation, browser tabs, and agent tools for reading, clicking, filling, navigating, and capturing the active page.
- Workbench views now use an icon rail with tooltips and keyboard navigation, leaving more room for the selected view.
- Workspace keeps its file explorer beside the editor, and opens files as editor tabs.
- The embedded browser can pick a page element and add it to the current chat draft as a removable chip with an expandable preview. Its selector, text, size, and HTML are included as ordinary message text when sent; Escape cancels selection, and picking never sends the draft.

- MCP servers can be added by local command or Streamable HTTP URL in Global or workspace scope. Settings groups them by scope; workspace chats get their workspace's tools alongside globals, with workspace servers taking precedence on name clashes. Workspace servers start when a chat in that workspace opens, and open chats in different workspaces receive only their own tools. Servers can be edited, reconnected, enabled or disabled, and narrowed to selected tools; failures and live tool-list changes are shown without restarting chats. Stdio environment variables and HTTP headers or bearer tokens are encrypted with the OS key store when available; otherwise they remain available only for the current app session. They can be replaced or cleared without revealing saved values. OAuth-protected HTTP servers can be signed into through the system browser; callback state is checked locally, tokens and registration are OS-encrypted, and expired access tokens refresh automatically.

- Projects now keep a server-owned glossary with attributed current terms and immutable history. Kira can add or sharpen language from a chat, and the chat offers a faint, stale-safe Undo note rather than an approval card.

- Tickets now support exactly eight kinds — prototype, bug, feature, refactor, question, research, spec and map. Existing decision tickets are read as questions, and an empty spec stays blocked until it has child tickets.

- Global local-command MCP servers can be added, viewed and removed from Settings. Kira starts one shared copy of each configured server, shows its connection and discovered tools, and gives those tools to every chat.
- The Context tab shows what Kira concluded, not only what she was told. What she worked out is drawn
  above the things it was drawn from, each conclusion saying the turn it had read through, so how far
  back it reaches is visible: one drawn early reads differently from one drawn over the whole chat.
  Reading them is not a turn and costs nothing, as reading the rest of her memory is not, and turning
  memory off leaves the pane empty of both.

- A new ticket keeps its typed words when the queue becomes unreachable while it is being written;
  the surface shows the failure and lets the person retry without starting the form over.

- The workbench tree keeps up with the folder it shows: a file Kira writes appears without the pane
  being closed or a control being pressed, and so does a file deleted or a folder created under one
  that is open. The levels the pane is showing are watched in the main process — `fs.watch`, one
  watch each, no watcher dependency — so opening the tab is immediate however large the folder is,
  and a burst of changes arrives as one read rather than one per file, since a run writing twenty
  files is one change to the tree. Only the levels the pane is holding are read again, the watch is
  released when the workspace tab stops showing or the chat changes, and a folder the platform will
  not watch is still listed correctly rather than drawn as empty.

- The workbench's tree draws what kind of file each row is, so a test, a config, a stylesheet and a
  screenshot are told apart at a glance instead of sharing one glyph. The vocabulary is the VS Code
  Material Icon Theme's, bundled whole with the app: its own manifest already answers for a couple of
  thousand file names and extensions, so nothing here keeps a list of types to recognise. The icons
  follow the window's light or dark, and the chrome around them is unchanged.

- What a project learned outlives the chat that learned it. A chat filed under a project leaves what
  it worked out with the project on its way out, so deleting one of a project's chats no longer takes
  a decision out of the memory of the chats beside it — the next chat to compact in that project still
  carries it. What is kept is the fact rather than the turn it came from, since the turn went with the
  chat, so it reads as something Kira knows rather than something she can check, and the same thing
  worked out by two chats is kept once. A chat filed nowhere still takes what it worked out with it,
  and forgetting a project forgets what it was keeping.

- The workbench marks the files Kira has changed, with a dot beside them in the tree. The marks are
  git's own answer, read in the same call that lists the folder rather than once per row: a file put
  back the way it was committed loses its mark, and a folder that is not a checkout marks nothing and
  says so rather than looking untouched. Showing the workspace tab again reads the folder again, so a
  file written since you last looked arrives marked.

- Settings holds what Kira remembers. What a chat works out can be turned off, and the model that
  draws the conclusions chosen, from the Settings page; both belong to your account rather than to
  one machine, so they follow you to every desktop you sign in on. The picker marks the model the
  server suggests, and a deployment can name which one that is — nothing the server can read knows
  what a model costs, so the suggestion is a named preference or the pool's own first pick rather
  than a computed cheapest. Turning memory off stops the observations, the conclusions and the
  project's side of the summary, and leaves compaction exactly as it was: a chat still compacts,
  still shows its boundary, and still has `recall`.
- The workbench opens a file. A click on a file in the workspace tree puts its text in a tab beside
  the tree, and clicking it again brings that tab forward rather than opening a second one. Tabs close
  with the cross on them or Delete while one has focus, and closing one leaves the pane where it was.
  What is shown is what the file held when it was opened: no editing, no saving. A file too large to
  read, or one that is not text, says so where its contents would be rather than filling the tab with
  something that is not the file; files stay open per chat, so switching chats and back finds each
  chat's own where it left them.
- Work now has a project navigator in the sidebar. It lists available projects once, opens the single
  linked workspace directly, asks which local workspace to use when there are several, and lets a
  person choose a folder when none is linked. Workspace menus remain direct shortcuts to their
  project's queue.

- Settings → Git hosts is a ledger of connected hosts, and connecting one is a dialog: pick GitHub, GitLab, Forgejo or Gitea from tabs with their marks, fill only what that host takes (GitHub offers the GitHub App first), and copy the webhook URL and secret from one receipt. Closing the receipt before copying the secret asks twice, since it cannot be shown again.

- Settings → MCP servers is a grid of servers with a status on each and an Add tile. A server opens on a page of its own with Overview, Tools and Settings tabs; adding one takes a pasted command or a link, environment variables as name and value rows, and an optional JSON snippet from the server's README. Removing a server now asks first.

### Changed

- Kira has a new color theme: warm, neutral ink and paper grays instead of rose-tinted ones, with Kira red as the single accent in both light and dark mode, plus matching code highlighting.
- A folder is a workspace, and it works a project. What you add a folder as was called a project,
  which is now the name for the shared body of work its tickets belong to: a workspace is where the
  work happens, several workspaces can work one project, and a chat stays filed under the folder it
  ran in. Folders you had already added keep their name and their chats, and are offered a project
  to work the first time their work is opened.

- The Work board uses fixed-width status lanes and keeps a selected issue beside the board, so its
  details stay open without hiding the rest of the work.

- Kira can look beyond the chat she is in: a search can reach every chat filed under the same
  project, so what was settled in one is findable from the next without remembering which chat it
  was in. A hit from another chat is named by that chat rather than by a turn number, because a
  turn number only means something in the chat it came from.
- A compacted chat now carries what Kira is holding and not only where the work stands: every
  change of plan is kept rather than the latest one alone, each line names the turn it came from
  so `recall` can go back to the words behind it, and a chat filed under a project carries what the
  rest of that project decided. What a summary carries is bounded, so a long chat cannot flood it.
- Compacting a long chat no longer asks a model to write the summary: Kira reconstructs it from
  the turns being discarded, so housekeeping costs nothing from your allowance.
- A compacted chat now carries what the work was and not only what was said. The goal, the files
  it touched, the commits it made and what you asked for are read out of the whole conversation
  rather than out of the last summary, so the fifth compaction knows what the first one knew
  instead of knowing less. Opening a compaction marker shows all of it.
- Kira's models come from Kira rather than from credentials on your machine: signing in is
  what gives her one, and the list is remembered, so a chat opens with the same models when the
  server cannot be reached.
- Kira has its own typeface: Inter for text, Satoshi for headings, and Geist Mono
  for code and commands.
- Kira has its own brand accent and now uses a subtle Astryx radius scale, restoring lightly
  rounded corners instead of the previous sharp, unrounded look.
- Ask again, Edit and Fork are icon buttons, named on hover, and a reply's actions sit
  once per turn beneath the words they act on rather than under each step of her work.
- Kira's expanded work now reads as a single execution trace: reasoning, each tool, and its result share a quiet rail instead of separate cards.
- Opening a chat no longer moves it in the sidebar; chats move with conversation activity instead.
- A new chat is composed before it exists: pressing New chat writes nothing and makes nothing —
  not the chat, nor the folder it would work in — and shows nothing in the sidebar. The chat is
  made in the right folder or project when its first message is sent, and joins the sidebar as the
  words go. Leaving a new chat to read another one and coming back keeps what was typed in it.
- The chat sidebar can be sorted by recent activity, created date, or alphabetically, chosen from
  the row that heads its chats, with the choice remembered.
- New chat and New project are flat rows with their icon leading the label.
- A project cannot be removed while Kira is writing in one of its chats, and removing one otherwise
  leaves its chats — and any chat being composed for it — filed nowhere, still working where they were.
- The chat sidebar collapses: a project's chats open in a flyout from its icon, the project
  holding the chat on screen is marked, and the collapsed state is kept between runs like the
  width.
- The native Electron menu bar is disabled; Kira's in-window controls are the only menu surface.
- The window is drawn inside Astryx's app shell: the sidebar is titled Kira, its width is
  dragged into place and kept between runs, a window too narrow to hold it puts the navigation
  behind a toggle, and the window gains a skip link and named navigation and main landmarks.
- The chat pane has a soft full-width atmospheric glow and a centered reading column, while the
  elevated sidebar remains flush against it as a distinct tonal panel.

### Added

- The workbench can show the chat's workspace as a tree. Folders open one level at a time, so a
  large workspace costs nothing until you look at it, and the files git ignores stay hidden until
  they are revealed by the ticket that adds that control. A folder that is not a checkout — or a
  machine with no git — is shown whole and says so rather than drawing a filter that was never
  applied. A chat nothing has been said in yet says it has no workspace rather than showing an
  empty one.
- A pane beside the chat holds what Kira is holding, under a header row that names the chat and a
  control that shows and hides it. Its width and whether it is showing are kept between runs.
- A chat shows what Kira is holding beside it: the goal of the work, the files she changed and
  read, the commits she made, and what you asked for and corrected. It is kept outside the
  conversation, so reading it costs nothing and it is never sent to a model. It is worked out from
  the chat itself as you go, which is why it costs nothing to record and why a chat reopened after
  months still knows what the work was.
- Kira can look back at a chat's own history. A long chat that has been summarised no longer leaves
  its beginning unreachable: she can read an earlier turn back by its number, search the chat for
  the turns that say something, and trace anything she is holding back to the turn it came from.
  She can also read a turn again for what a summary leaves out — the reasoning behind an answer,
  the arguments a tool was handed, the whole of what a tool handed back, and the contents of a file
  the turn touched, a page at a time. She has to ask, so the transcript shows when she checked
  rather than remembered.
- A compacted chat shows where it was summarised: a quiet line across the transcript, above the
  message that carries on from it, that says how many earlier turns went and quotes the last thing
  you asked before the cut. Opening it shows the whole reconstruction Kira kept.
- The desktop app has a Settings page with account details, a clear sign-out action, and a home
  for future workspace preferences.
- You can choose which model Kira uses for a chat, from the composer: a chat keeps its own
  choice, and changing it changes the chat you are in. What is on the list is what the pool
  is willing to serve, in the order it ranks it, and a new chat starts on the model you were
  just using rather than back at the pool's own preference.
- You can see the month's allowance: the composer shows how much of it you have used, and says
  so when you are close to it — before a message is turned away rather than only afterwards.
- A tool call keeps what it actually produced: opening one shows the whole command it ran
  and its output, the change itself for an edit, and the complete file body for a successful
  write instead of pi's receipt.
- Kira's answers are drawn flat: the width of the pane, with the words read as markdown,
  so headings, lists and code blocks have room — a code block carries its language and
  a button to copy it. Your own message keeps its bubble on the right, with edit and
  fork beneath it.
- The chat list down the side, with a New chat button and a working folder of its own
  for each chat.
- Branching: saying the same thing again keeps both exchanges rather than replacing
  one, and the question then carries a `1 / 2` picker to move between them; the
  conversation carries on from the branch you are looking at, and is still looking
  at it after a restart.
- Ask again, which puts the same question to Kira and keeps both answers.
- Edit, which changes a message you sent: the words it replaces stay in the chat as a
  branch you can go back to, and Kira answers the version you saved.
- Fork: a message can start a chat of its own, holding the conversation up to that
  message while the chat it came from stays where it was.
- Chats run beside each other: switching chats leaves the one you left working, a turn
  keeps going while you read or write in another chat, the sidebar shows which chats
  Kira is writing in, and opening one of those shows the reply as far as it has got.
- The composer is Astryx's chat composer: one rounded box holding the words, the send
  button and the line a failed turn appears on, growing with what you type.
- The send button becomes a stop button while Kira is writing: stopping ends the reply
  where it is and keeps what she had already written, and anything still waiting to be
  read comes back to the box.
- Words written while Kira is answering wait their turn instead of being refused.
  Enter hands them over at her next step, so she can be redirected mid-answer; Alt+Enter
  holds them until the turn is finished. What is waiting is listed above the composer,
  and can be taken back into the box — by Take them back, or by stopping, which hands
  back whatever she had not reached yet.
- Projects: a folder to work in, listed down the side with the chats that work in it.
  A project exists before anything is said in it, all of its chats share its folder — so
  the instructions in a file beside that work are theirs, and so are the files — and
  removing one takes nothing with it: its chats keep working where they were working,
  and choosing that folder again picks them back up.
- What Kira ran is shown as work rather than as a line of text: each tool has a tick, a
  cross or a spinner for how it went, the file or command it acted on, how long it took,
  and — for an edit — how many lines went in and came out. Tools she ran one after
  another are gathered into one row with its own count, so a turn that read four files
  reads as one step instead of four.
- What she thought before acting or answering is shown too, behind the same step: a
  "Worked for" row when it ran anything, "Thought for a moment" when it was reasoning
  alone. It opens on its own while the turn that wrote it is still running — through
  the tools and the answer that follows them — and closes when that turn ends, so a
  step read as history stays out of the way; click it to read the thinking, markdown
  and all, and the tools that came from it.
- A reply says what wrote it: pointing at one shows the model, how long its turn took,
  and the time it finished, beside its actions.
- A chat's row can be right-clicked: Archive takes it out of the sidebar and keeps
  everything it holds, and Delete asks first and takes the conversation and everything
  said in it with it. The folder it worked in is left where it is, and neither can be
  used while Kira is writing in that chat.
- The app signs in with your company Microsoft account. A machine that is not signed in
  shows only the sign-in; signing in leaves for the system browser and comes back on its
  own, with nothing to copy or paste. The key Kira issues is kept encrypted by the
  operating system, is still there after a restart, and is taken off the machine when you
  sign out.

- Kira now draws conclusions. Once per compaction a model reads what the chat has recorded and says
  what it amounted to — a decision and why it was made, a constraint, a correction — and those
  conclusions are kept with the chat, carried into later summaries, and never dropped for being old.
  It runs on the model the chat itself runs on, so a conclusion is drawn by whatever did the work,
  and a chat whose conclusions cannot be drawn still compacts.

- A chat can be compacted when you want it to be, rather than only when its window fills: the gauge
  beside the composer offers it, so a long chat can be tidied at a natural boundary. What it does is
  what compaction always did — the chat keeps every word it held, and a boundary across the
  transcript says where it was summarised — and the boundary is there at once rather than waiting
  for the next message to carry it.
