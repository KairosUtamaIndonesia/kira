# Changelog

## [Unreleased]

### Added

- Packaged desktop builds check for updates automatically, download them in the background, and offer a restart to install from Settings. macOS, Windows, and Linux AppImage are supported.

- Users on Windows, macOS, and Linux can choose and test Kira's Bash-compatible executable from Settings. The saved device-local preference takes effect in open chats on their next command, and `$SHELL` in those commands matches the selected executable without changing the login shell. See [the shell setup guide](docs/custom-shell.md).

- Chat now shows an open work trace as soon as a turn starts, updates it with live reasoning and tool activity, and gathers the turn's work into one group until the answer begins.

- Kira can ask up to four structured questions in an inline chat card, with custom or partial answers, multi-select previews, per-question and shared notes, and cancellation.

- After approving a spec, Kira routes natural requests to make tickets through the bundled breakdown workflow. Kira validates proposals before showing the approval card; published drafts whose readiness was refused can be corrected and readied again without publishing a second breakdown.
- Chats can switch between Build, the default mode with workspace tools, and Spec, a planning mode with read-only tools. In Spec mode, approving a spec immediately prompts Kira to propose its ticket breakdown; the person approves that separately, then opens individual tickets in Work.
- When Kira completes a ready implementation ticket from a regular Build chat, she links the chat and completion evidence to the ticket and marks it done.
- The workbench now has a persistent embedded browser with safe HTTP(S) navigation, browser tabs, and agent tools for reading, clicking, filling, navigating, and capturing the active page.
- The embedded browser can pick a page element and add it to the current chat draft as a removable chip with an expandable preview. Its selector, text, size, and HTML are included as ordinary message text when sent; Escape cancels selection, and picking never sends the draft.

- MCP servers can be added by local command or Streamable HTTP URL in Global or workspace scope. Settings groups them by scope; workspace chats get their workspace's tools alongside globals, with workspace servers taking precedence on name clashes. Workspace servers start when a chat in that workspace opens, and open chats in different workspaces receive only their own tools. Servers can be edited, reconnected, enabled or disabled, and narrowed to selected tools; failures and live tool-list changes are shown without restarting chats. Stdio environment variables and HTTP headers or bearer tokens are encrypted with the OS key store when available; otherwise they remain available only for the current app session. They can be replaced or cleared without revealing saved values. OAuth-protected HTTP servers can be signed into through the system browser; callback state is checked locally, tokens and registration are OS-encrypted, and expired access tokens refresh automatically.

- Projects now keep a server-owned glossary with attributed current terms and immutable history. Kira can add or sharpen language from a chat, and the chat offers a faint, stale-safe Undo note rather than an approval card.

- Tickets now support exactly eight kinds — prototype, bug, feature, refactor, question, research, spec and map. Existing decision tickets are read as questions, and an empty spec stays blocked until it has child tickets.

- Global local-command MCP servers can be added, viewed and removed from Settings. Kira starts one shared copy of each configured server, shows its connection and discovered tools, and gives those tools to every chat.
- A ticket can be claimed and run. Pressing Run on a ready ticket takes a lease on it, says so on
  the desktop that took it, and works it in a checkout of its own on the ticket's branch — the
  project's folder is left alone and the branch survives the checkout being thrown away. The ticket
  reads Running while somebody holds it, and the run is a chat beside the others: it is named for its
  ticket, marked with a ticket so it is not mistaken for a conversation somebody had, steered while
  it goes, and still there to read when it is over. When it stops it leaves a proposal on the ticket
  — what it changed, what it ran, and what it had to say — and the ticket asks for a person:
  accepting says the work is right, sending it back says it is not, and neither closes the ticket.
  The run's own words belong to the project rather than to the machine that ran it, so a ticket hands
  over to its run's chat where there is one and reads them out where there is not. A ticket claimed
  by a desktop that stopped answering reads as gone quiet rather than as held, and can be taken over
  by hand. Closing the app mid-run leaves the run where it is instead of releasing it. A ticket
  that has been run several times keeps every run, newest first, so what it did before is readable
  beside what it is waiting on.

- The Context tab shows what Kira concluded, not only what she was told. What she worked out is drawn
  above the things it was drawn from, each conclusion saying the turn it had read through, so how far
  back it reaches is visible: one drawn early reads differently from one drawn over the whole chat.
  Reading them is not a turn and costs nothing, as reading the rest of her memory is not, and turning
  memory off leaves the pane empty of both.

- Tickets live in Kira rather than in a tracker beside it. A project is a shared body of work
  with a short prefix of its own, so its tickets are named `FND-12` and a number is never reused; a
  ticket carries what to build, how it is known to be done, and the tickets that gate it. A slice
  blocking its parent is the only relation there is, so a parent is buildable once nothing under it
  is open. Closing a slice as `wontfix` releases its parent all the same, and a parent resting on
  work nobody did says so rather than hiding it. Every ticket shows the branch it would be worked
  on, derived from its name and title, and copies it in one press.

- The queue's bands are derived, never dragged: draft, ready, blocked and done are read off what is
  written, what is closed and what is still open, so a board cannot show a state the machine does
  not have. A ticket still in draft is answered and kept but stays off the frontier, so an idea can
  be written down now and asked for later. Nothing takes a ticket yet: it is marked ready for an
  agent or for a person, and the run that would take it is its own piece of work.

- The Work surface reads and writes a project's queue: the whole queue as a list, the bands side by
  side, or a worklist beside the ticket it has open. A ticket is opened by saying its name, written,
  corrected, marked ready, put back to a draft, gated by naming another ticket, ungated, and closed
  as done or as something that will not be done — and a ticket an agent is to run is refused until it
  says how it is known to be done. A name this project does not have says so, rather than looking
  like a ticket that is nowhere. Each workspace's row in the sidebar opens it, and a folder that
  works no project yet is offered one to start or to join.

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

### Changed

- A folder is a workspace, and it works a project. What you add a folder as was called a project,
  which is now the name for the shared body of work its tickets belong to: a workspace is where the
  work happens, several workspaces can work one project, and a chat stays filed under the folder it
  ran in. Folders you had already added keep their name and their chats, and are offered a project
  to work the first time their work is opened.

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
- Kira has its own brand accent and a sharp, unrounded look, instead of Astryx's stock Neutral
  theme.
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
  alone. It opens on its own while something in it is still running, and stays out of
  the way, collapsed, once it is history — click it to read the thinking, markdown and
  all, and the tools that came from it.
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
