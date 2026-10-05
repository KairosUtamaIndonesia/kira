# Git and Pull Request views for the desktop workbench

Date: 2026-10-05
Status: research for two deliverables. The **Git view** operates only on the chat's
local workspace checkout — status, diff, stage, commit, history, branches — and never
calls a Git host. The **Pull Requests view** is a second, separate deliverable that
reads pull requests from the connected host / Kira server.

The reference implementation is the sibling repository at
`/home/brandon/Workspace/openchamber`, commit
[`e840823d`](https://github.com/openchamber/openchamber/blob/e840823dc0517a85e1c435ce698ea07152857dd6)
(2026-09-28). Citations of openchamber files use the shorthand
`openchamber:<path-from-repo-root>#Lx-Ly`; every one resolves to
`https://github.com/openchamber/openchamber/blob/e840823dc0517a85e1c435ce698ea07152857dd6/<path>`.
In the tables below, a bare `Foo.tsx#Lx-Ly` means
`openchamber:packages/ui/src/components/views/git/Foo.tsx#Lx-Ly`, because every listed
component lives there; in the §2.1 table `github/routes.js` means
`openchamber:packages/web/server/lib/github/routes.js`. Foundry paths are
repo-relative links.

## Bottom line

**The Git view ports, and it is mostly already sitting in `workspace/git.ts`.** Every
operation the openchamber Git view performs is a `git` process run in the folder —
none of it is a host call, and openchamber runs the same `simple-git` dependency Kira
already has (`openchamber:packages/web/server/lib/git/service.js#L1`,
`apps/desktop/src/main/workspace/git.ts#L20`). What Kira actually lacks is three
things: a **git read path** (log, commit files, per-path diff), a **serialised index
mutation queue** (openchamber has two, client and server:
`openchamber:packages/ui/src/components/views/git/gitIndexMutationQueue.ts#L33-L94`,
`service.js#L438-L464`), and any **write channel** in the workbench. The premise that
the workbench is read-only is already stale: `ipc/files.ts` exposes `write`, `create`
and `upload` (`apps/desktop/src/main/ipc/files.ts#L65-L67`, `#L164-L197`) and
`reading.ts` writes files (`apps/desktop/src/main/workspace/reading.ts#L82-L101`).

**The Pull Requests view does not port as-is, because it is a different shape.**
Kira's server is already provider-agnostic and *event-driven*: pull requests arrive by
webhook and are mirrored onto the ticket they name
(`apps/server/src/git.ts#L1113-L1202`), and the one read is
`GET /api/tickets/:ref/pull-requests` (`#L1055-L1101`). openchamber's PR view is
*by-directory → repository*, GitHub-only, and calls Octokit live from the server with
a user token (`openchamber:packages/web/server/lib/github/auth.js#L5-L15`). Kira has no live "list a
repository's pull requests" call to a host at all; the only outbound host request in
`git.ts` is the GitHub App installation-repository listing
(`apps/server/src/git.ts#L1503-L1521`). So the PR view's first decision is not UI, it
is **what answers it**: mirrored ticket-linked rows, or a new live host read.

## 0. How openchamber is shaped, in one paragraph

`GitView.tsx` is a 2,839-line controller: it owns *every* `git.*` call, the branch
and worktree context, the commit draft, the mutation queue and the dialogs, and hands
presentational components props (`openchamber:packages/ui/src/components/views/GitView.tsx#L204-L2839`). Only
two files in the whole `views/git/` directory call the runtime themselves —
`HistoryCommitRow.tsx` (per-commit cherry-pick/revert/reset/merge/rebase) and the
shared `commitAndPush.ts`. The server path (`packages/web`) is the primary one; the
VS Code webview (`packages/vscode/webview/api/git.ts`, 579 lines) and the desktop
Electron path are separate implementations of the same `GitAPI` interface, and the
VS Code runtime does not mount these Git panels at all
(`openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L97`,
`#L160-L161`). This note treats the web path as the source and says once where the
others diverge; it does not trace the VS Code or Capacitor implementations.

The same is true of GitHub: the UI (`packages/ui`) is shared, but the transport is
per-runtime, and the server module is GitHub-only in its client (`octokit.js`) even
though the Git module has no host at all.

---

## 1. openchamber's Git view

### 1.1 What is on screen, and what backs it

`GitView` renders a header, an in-progress-operation banner, a changes panel, a commit
section, and a set of dialogs (`openchamber:packages/ui/src/components/views/GitView.tsx#L2448-L2750`). Each
surface's data and mutations were traced from the component calls into
`packages/web/server/lib/git/routes.js` and `service.js`. Read/write is stated from
the route's effect.

| Surface (component) | Shows | Backed by (client → route → service) | R/W |
| --- | --- | --- | --- |
| `GitHeader` (`GitHeader.tsx#L1-L476`) | branch, ahead/behind, remote, identity, buttons for sync/history/graph/stashes/PR chip | status + branches reads | read |
| `SyncActions` (`SyncActions.tsx#L1-L174`) | Fetch / Pull / Push / Sync per remote | `gitFetch`→`POST /api/git/fetch` (`routes.js#L718-L732`), `gitPull`→`POST /api/git/pull` (`#L614-L628`), `gitPush`→`POST /api/git/push` (`#L630-L644`) | write |
| `BranchSelector` (`BranchSelector.tsx#L1-L508`) | local + remote branches, search, unpushed counts, create/rename/delete, dirty-switch warning | `getGitBranches`→`GET /api/git/branches` (`#L908-L922`); create `POST` (`#L940-L959`); delete `DELETE` (`#L961-L980`); rename `PUT` (`#L983-L1005`); `POST /api/git/checkout` (`#L1027-L1046`) | write |
| `ChangesPanel` (`ChangesPanel.tsx#L1-L637`) | staged and unstaged groups, virtualised tree, per-row +/−, revert, diff stats | status + diff reads; stage `POST /api/git/stage` (`#L543-L563`); unstage `POST /api/git/unstage` (`#L565-L585`); revert `POST /api/git/revert` (`#L522-L541`) | write |
| `ChangeRow` (`ChangeRow.tsx#L1-L196`) | one file, its status code, kind icon, +/− action, view-diff | stage/unstage/revert routes above | write |
| `CommitSection` (`CommitSection.tsx#L1-L187`) | commit message, staged count, generate-message, Commit / Commit & Push | `POST /api/git/commit` (`#L883-L906`); generate message `POST /api/git/commit-message` (`gitApiHttp.ts#L647`) | write |
| `HistorySection` (`HistorySection.tsx#L52-L257`) | commit log, load-more, graph mode, branch divider | `getGitLog`→`GET /api/git/log` (`routes.js#L1330-L1352`); `getCommitFiles`→`GET /api/git/commit-files` (`#L1354-L1371`) | read |
| `HistoryCommitRow` (`HistoryCommitRow.tsx#L1-L680`) | per-commit expand, files, per-file before/after, actions | `getGitCommitDiff` (`gitApiHttp.ts#L1043`); checkout/cherry-pick/revert/reset/merge/rebase routes (`routes.js#L1048-L1125`) | read + write |
| `HunkActions` (`HunkActions.tsx#L1-L61`) | per-hunk stage/unstage/discard in the diff viewer | `POST /api/git/apply-hunk` (`#L587-L612`) | write |
| `ConflictDialog` (`ConflictDialog.tsx#L1-L268`) | unresolved files, per-file detail, abort, "resolve with AI" | `getConflictDetails`→`GET /api/git/conflict-details` (`#L867-L881`); abort/continue merge and rebase (`#L787-L865`) | write |
| `InProgressOperationBanner` (`InProgressOperationBanner.tsx#L1-L150`) | merge/rebase in progress, continue/abort, conflict count | status carries `mergeInProgress`/`rebaseInProgress` (`openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L149-L150`) | read |
| `StashesDialog` (`StashesDialog.tsx#L1-L198`) | list/apply/pop/drop stashes | `GET /api/git/stashes` (`#L646-L656`), `POST /api/git/stash` (`#L670-L680`), `/stash/apply` (`#L682-L692`), `/stash/pop` (`#L694-L704`), `/stash/drop` (`#L706-L716`) | write |
| `StashDialog` (`StashDialog.tsx#L1-L129`) | "stash then retry" for merge/rebase over dirty tree | uses `stash()` from `GitAPI`, then merge/rebase | write |
| `DirtyBranchSwitchDialog` (`DirtyBranchSwitchDialog.tsx#L1-L197`) | commit (and optionally push), or revert, before switching | `createGitCommit` then `checkoutBranch` | write |
| `BranchIntegrationSection` (`BranchIntegrationSection.tsx#L1-L496`) | choose branch to merge/rebase into current, operation log | `POST /api/git/merge` (`#L803-L817`), `POST /api/git/rebase` (`#L771-L785`) | write |
| `IntegrateCommitsSection` (`IntegrateCommitsSection.tsx#L1-L527`) | worktree-only: cherry-pick a worktree's commits onto its base | `POST /api/git/integrate/*` (`#L340-L381`) | write |
| `GitEmptyState` (`GitEmptyState.tsx#L1-L66`) | clean tree, open stashes | none | — |
| `NestedRepoPicker` (`NestedRepoPicker.tsx#L1-L67`) | pick which nested repo the view operates on | `GET /api/fs/git-dirs` (`gitApiHttp.ts#L195-L202`) | read |
| Git graph (`gitGraph.ts#L56-L181`, `HistorySection.tsx#L74-L87`) | lane/connector SVG per commit | pure function over `GET /api/git/log` (`?all=true&maxCount`) | read |

The header's PR chip is the seam between the two deliverables: `GitView` subscribes
to the same shared GitHub PR store the sidebar uses and passes `pullRequest` and
`prChecks` down (`openchamber:packages/ui/src/components/views/GitView.tsx#L329-L335`,
`openchamber:packages/ui/src/components/views/GitView.tsx#L2475-L2479`).

### 1.2 How the server runs git

`service.js` is 6,055 lines and is the whole transport. It calls `simple-git`
(`#L1`), always pins an explicit `baseDir` (`createGit`, `#L362-L395`) so a command
can never inherit `process.cwd()`, resolves the git binary per platform including a
Windows install search (`#L196-L238`), and builds an environment that sets
`GIT_TERMINAL_PROMPT=0` and resolves `SSH_AUTH_SOCK` (`#L345-L360`). There is a
separate `runGitCommand(cwd, args)` for raw `git` invocations rather than the
simple-git object (`#L1026-L1052`).

**Diffs are not streamed.** Every diff route returns a whole JSON body:
`GET /api/git/diff` returns `{ diff, submodule }` (`routes.js#L383-L411`),
`GET /api/git/file-diff` returns `{ original, modified, ... }` (`#L413-L445`), and
`GET /api/git/range-diff` returns `{ diff }` (`#L447-L477`). The client fetches a
patch as a string and renders it (`gitApiHttp.ts#L315-L412`). The reference's answer
to large diffs is a **timeout and a cache**, not a stream: `HistoryCommitRow.tsx`
sets a 15 s per-request timeout, only auto-loads diffs under 500 changed lines, and
caps its cache at 8 MB (`openchamber:packages/ui/src/components/views/git/HistoryCommitRow.tsx#L19-L22`). Diff
prefetching is bounded too (`GitView.tsx#L100-L101`, `#L1044-L1075`).

**Status is serialised and mode-aware.** A full status read walks the working tree
and runs a dozen git processes, and clients ask after every completed agent tool
call, so `readStatus` is wrapped in `createSerialRefresh({ maxConcurrent: 4 })`
(`service.js#L2462-L2485`). That helper runs one refresh per directory at a time and
allows at most one pending follow-up, so a caller that asks mid-run gets a run that
started after it asked (`serial-refresh.js#L1-L93`). Untracked entries use
`git status -unormal` and directories are expanded afterwards up to a bound, because
`-uall` on a forgotten `node_modules` is a full scan per read (`service.js#L2532-L2539`;
`openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L27`).

### 1.3 Serialising index mutations

This is the mechanism Kira most clearly lacks, and it exists at two layers.

1. **Client-side, optimistic.** `createGitIndexMutationQueue` coalesces queued
   stage/unstage mutations for the same directory and direction, runs one at a time,
   and rolls the optimistic status back on failure
   (`openchamber:packages/ui/src/components/views/git/gitIndexMutationQueue.ts#L33-L94`). `GitView` uses it with a
   `setTimeout(..., 0)` flush, a `bumpIndexRevision` and a **15-second silent status
   reconcile** after each mutation (`GitView.tsx#L86`, `#L375-L439`, `#L1721-L1739`).
   The move is applied to the status snapshot before the server confirms it
   (`moveStatusPathsOptimistically`) so the row jumps immediately.
2. **Server-side, per repository.** `withGitIndexMutationQueue` chains each mutation
   onto the previous promise for the resolved repository root, so two requests from
   two windows cannot interleave `git add`/`restore` on one index
   (`service.js#L430-L464`). `stageFiles` and `unstageFiles` both run inside it
   (`#L3890-L3932`, `#L3938-L3959`), including a per-path retry when a batch `git add`
   fails on one unmatched pathspec (`#L3908-L3930`).

The reason this matters to Kira: `changedByGit` runs `simpleGit.status()`
(`apps/desktop/src/main/workspace/git.ts#L107-L124`), and `git status` refreshes and
writes the index (optional locks). Kira's watcher then re-lists on every burst
(`apps/desktop/src/main/workspace/watching.ts#L107-L147`). A Git view that stages
while the tree keeps reading status is exactly the contention openchamber's two
queues exist to remove. Kira has neither.

### 1.4 History and the graph

History is one call, `GET /api/git/log` with `maxCount`/`from`/`to`/`file`/`all`
(`routes.js#L1330-L1352`), and the graph is computed **entirely in the client** by a
greedy lane-assignment function over newest-first commits, using each commit's parent
list (`openchamber:packages/ui/src/components/views/git/gitGraph.ts#L47-L181`). The server does not run
`git log --graph`. A "branch divider" is a second log call from the base branch to
`HEAD`, then a set-difference of hashes to find where the current branch's own
commits begin (`GitView.tsx#L1629-L1692`). Per-commit file lists are lazy, fetched
when a row is expanded (`GitView.tsx#L799-L867`).

---

## 2. openchamber's Pull Requests view

### 2.1 What is on screen, and what backs it

`PullRequestView` resolves the same repository/branch/base context the Git view does
and renders `PullRequestSection` full-size (`openchamber:packages/ui/src/components/views/PullRequestView.tsx#L38-L327`).
`PullRequestSection` has four segments — overview, checks, comments, files — and all
four come from two routes: a **status** route keyed by directory+branch, and a
**context** route keyed by directory+PR number.

| Surface | Shows | Backed by (client → route) | R/W |
| --- | --- | --- | --- |
| PR status chip (Git view header, sidebar) | PR number, state, draft, mergeable, checks rollup, can-merge | `github.prStatus`→`GET /api/github/pr/status` (`github/routes.js#L499-L712`) | read |
| PR overview | title, body, base/head, mergeability, author | `github.prContext`→`GET /api/github/pulls/context` (`#L1545-L1897`) | read |
| Checks segment | check runs, per-job steps, annotations, combined status fallback | same context route with `checkDetails=1`; status route checks (`#L584-L616`) | read |
| Comments | issue comments and review comments | context route (`#L1638-L1669`) | read |
| Files / diff | changed files, patches, and optionally the full PR diff | context route `listFiles` (`#L1671-L1684`) and `GET /pulls/{n}` with `accept: ...diff` (`#L1866-L1875`) | read |
| Comparison picker (`PullRequestComparisonSelector.tsx#L13-L72`) | browse/search any open PR in the repo network and diff against it | `github.prsList`→`GET /api/github/pulls/list` (`#L1413-L1543`) with page+query | read |
| Create PR | title, body, base, head, draft, target repo | `github.prCreate`→`POST /api/github/pr/create` (`#L714-L917`) | write |
| Edit PR | title and body | `github.prUpdate`→`POST /api/github/pr/update` (`#L919-L994`) | write |
| Merge PR | merge method (default squash) | `github.prMerge`→`POST /api/github/pr/merge` (`#L996-L1041`) | write |
| Mark ready | un-draft via GraphQL | `github.prReady`→`POST /api/github/pr/ready` (`#L1043-L1095`) | write |
| `GitHubAccountControl` (`github/GitHubAccountControl.tsx#L43-L161`) | connected avatar, account switcher (OAuth + `gh` CLI) | `GET /api/github/auth/status` (`#L190-L262`), `POST /api/github/auth/activate` (`#L366-L460`) | write |

The action handlers are `createPr`/`mergePr`/`markReady`/`updatePr`
(`openchamber:packages/ui/src/components/views/git/PullRequestSection.tsx#L1291-L1434`). Each triggers a forced
refresh plus delayed re-polls at 2 s and 5 s to absorb GitHub eventual consistency
(`openchamber:packages/ui/src/components/views/git/PullRequestSection.tsx#L105`,
`openchamber:packages/web/server/lib/github/DOCUMENTATION.md#L153-L158`).

### 2.2 PR operations and their inputs/outputs

`prStatus(directory, branch, remote?, {force?})` returns `{ connected, repo, branch,
pr, checks, canMerge, defaultBranch, resolvedRemoteName }`; `pr` carries `number,
title, body, url, state, draft, base, head, headSha, mergeable, mergeableState`
(`github/routes.js#L651-L672`). `prContext(directory, number, {includeDiff,
includeCheckDetails, sourceRepo?})` returns `{ connected, repo, pr, issueComments,
reviewComments, files, diff?, checks, checkRuns? }` (`#L1877-L1887`). `prsList` is
paged at `per_page: 50` with a `hasMore` derived from the `Link` header
(`#L1510-L1521`, `usePullRequestComparison.ts#L66-L117`). `prCreate` returns the
created PR's fields (`#L886-L898`); `prMerge` returns `{ merged, message }`
(`#L1027`); `prReady` returns `{ ready }` (`#L1090`).

### 2.3 Auth model

Three token sources, resolved in `getOctokitOrNull`: an active stored account, the
`gh` CLI token, and an explicit-account selection, with `gh` CLI preferred when
active (`github/octokit.js#L76-L84`). Devices: OAuth device flow against a client id
(`auth.js#L13-L15`, `device-flow.js`), stored per-account in
`~/.config/openchamber/github-auth.json` with atomic `0o600` writes
(`auth.js#L45-L63`), and the `gh` CLI token read from the machine
(`gh-cli-credential.js`). Scopes default to `repo read:org workflow read:user
user:email` (`auth.js#L14`). Every Octokit call is wrapped with an 8 s timeout and an
ETag conditional cache, because GitHub serves `304` without charging rate limit
(`octokit.js#L10-L69`), and a rate-limit cooldown serves stale cache rather than
failing (`rate-limit.js`; `github/routes.js#L519-L525`).

This is the part that is **GitHub-specific and must not be copied**: a personal
access token in a desktop/CLI app is a different trust model from Kira's server,
which holds connection secrets sealed at rest and mints App installation tokens live
(`apps/server/src/schema.ts#L488-L518`, `apps/server/src/git.ts#L1478-L1495`).

### 2.4 What is provider-agnostic

Only two layers are portable: the **shape of a PR** (`number, title, state, draft,
url, branch, headSha, authorLogin, mergedAt`) and a **checks rollup** (pending /
passed / failed / neutral). Kira already has both normalized provider-agnostically
for four providers (`apps/server/src/git.ts#L38-L62`, adapters at `#L84-L416`,
registry at `#L487-L492`), and its schema stores exactly those fields
(`apps/server/src/schema.ts#L564-L621`). Everything else in openchamber — Octokit,
device flow, `gh` CLI, ETag, fork-network resolution — is the GitHub adapter, which
Kira's `GitProvider` interface and webhook mirroring already replace. The one
GitHub-only structural feature openchamber relies on is the **fork network**
(`openchamber:packages/web/server/lib/github/repo/fork-detection.js#L60-L102`): a PR may live in the upstream repo while the
checkout's `origin` is a fork. Kira's `parseRemote` + `provider/owner/name` model has
no fork concept (see §4.3).

---

## 3. Kira's existing seams

### 3.1 The main process owns the disk (`workspace/`)

`workspace/git.ts` is the existing git boundary. It has `listedByGit` and
`changedByGit` (read), `hasRemote`, `remoteOf`, `parseRemote`, `providerOf`,
`cloneUrl`, `cloneInto`, `branchesOf`, `isolatedCheckout`, `insideFolder`,
`splitListing` (`apps/desktop/src/main/workspace/git.ts#L77-L295`). It runs every
command in the folder being listed, so paths come back relative to it, and it has a
documented tests seam (`git.test.ts`). It has **no** log, diff, stage, commit,
checkout, merge or stash. `branchesOf` is exported and documented for a setup dialog
(`#L278-L295`) but is referenced only by tests today; no channel wires it.

`listedByGit`/`changedByGit` are consumed by `listFolder`, which joins the listing
and the status in one `Promise.all` (`apps/desktop/src/main/workspace/listing.ts#L30-L53`),
and `searchWorkspaceFiles` reuses `listedByGit` for path search
(`#L61-L82`). `reading.ts` reads, writes (with an expected-content guard),
creates, uploads and reads allowlisted assets (`reading.ts#L58-L144`), and
`watching.ts` is the debounced `fs.watch` over named levels (`watching.ts#L107-L147`).

### 3.2 The IPC + preload seam

Handlers are shaped as `(chatId, ..., path)` against a chat's workspace, checked
before use, and handed their dependencies (`apps/desktop/src/main/ipc/files.ts#L37-L59`,
`#L132-L252`); failures cross as `Result<T>` via `envelope`
(`apps/desktop/src/main/ipc/result.ts#L13-L19`). The channel names and wire types
live once in `preload/bridge.ts`, which both `preload/` and `ipc/` import
(`docs/internal/desktop-conventions.md#L285-L313`):

- `WORKSPACE_CHANNELS` — add/clone/remove/projects/join (`bridge.ts#L654-L660`).
- `FILE_CHANNELS` — list/search/read/write/create/upload/asset/watch/unwatch/changed
  (`bridge.ts#L1073-L1084`); the renderer surface is on `window.kira`
  (`bridge.ts#L1634-L1677`).
- `TRACKER_CHANNELS` — includes `pullRequests: 'tracker:pull-requests'`,
  `repositories: 'tracker:repositories'` (`bridge.ts#L669-L689`); renderer reads
  `loadPullRequests(ticketId)` (`bridge.ts#L1600-L1601`) and
  `loadRepositories(projectId)` (`#L1606-L1611`).
- `GIT_CHANNELS` — **host connections only**: connections/connect/disconnect/
  github-connect/connection-repositories (`bridge.ts#L691-L704`), implemented in
  `ipc/git.ts` (`apps/desktop/src/main/ipc/git.ts#L1-L107`).

The wiring is in `apps/desktop/src/main/index.ts`: `registerGitChannels` feeds
`ipc/git.ts` from `tracker.*` (`#L411-L427`); `registerFileChannels` hands the
`workspace/*` functions to `ipc/files.ts` (`#L444-L512`); all are registered after
the tracker is built (`#L1039-L1042`). The tracker is constructed with
`checkoutHasRemote: hasRemote` and `checkoutRepository: remoteOf`
(`#L997-L1008`), and `trackerFor` attaches the repository when a folder joins a
project (`apps/desktop/src/main/tracker.ts#L660-L669`).

### 3.3 The renderer workbench

The workbench is one component the window owns, with a vertical view rail and one
panel per view (`apps/desktop/src/renderer/src/workbench.tsx#L102-L186`). Its views
are Context, Spec/Tickets (when they exist), Agents, Workspace and Browser
(`#L179-L186`); the Workspace panel holds the editor tabs *and* the explorer tree
(`#L387-L478`). Per-chat tab state is isolated in `workbenchTabs.ts`
(`CONTEXT`/`WORKSPACE`/`SPEC`/`TICKETS`/`BROWSER` at `#L16-L25`; `opened`/`shown`/`closed`
at `#L67-L112`), so the shape a new Git view takes is: a new view constant, a new
panel in the rail, and per-chat state if it needs any. Layout is in `styles.css`
under the `.workbench*` rules (`styles.css#L231-L383`).

The workspace tree is drawn by `workspaceTab.tsx`, which fetches folders through the
`file:*` channels and paints what `workspaceRows.ts` decided
(`apps/desktop/src/renderer/src/workspaceTab.tsx#L1-L24`). PRs already have a
renderer surface: `workPullRequests.tsx` reads a ticket's PRs and draws state,
checks and author (`apps/desktop/src/renderer/src/workPullRequests.tsx#L27-L92`).
Git hosts have a model and a page (`gitHostsModel.ts#L38-L81`).

### 3.4 The server and schema

`apps/server/src/git.ts` normalizes four providers and mirrors delivered pull
requests and checks onto tickets:
`GET/POST /api/webhooks/github`, `POST /api/webhooks/git/:connectionId`,
`GET /api/git/connections`, `GET /api/git/connections/:id/repositories`,
`POST/DELETE /api/git/connections`, the GitHub App connect/setup routes,
`GET/POST/DELETE /api/projects/:ref/repositories`, and
`GET /api/tickets/:ref/pull-requests` (`apps/server/src/git.ts#L553-L1101`). The
mirror resolves a PR to a ticket by parsing `PREFIX-12` from its **title and branch**
(`#L1204-L1236`); a PR naming no ticket is ignored (`#L1140-L1143`), and a merge from
Needs review to Done is the only status change (`#L1183-L1201`). Checks roll up from
rows and a failed check is named (`#L1329-L1336`).

Tables: `repository` is a project's (`apps/server/src/schema.ts#L528-L553`),
`ticketPullRequest` is a ticket's with a nullable `repositoryId`
(`#L564-L593`), `pullRequestCheck` hangs off the PR (`#L603-L621`), and
`gitConnection` holds tokens/App metadata sealed (`#L488-L518`). There is **no**
`GET /api/projects/:ref/pull-requests` and no repository-keyed PR read: the only PR
read is by ticket.

### 3.5 Governing decisions

- **ADR 0014** — the tree's filtering is git's answer, via `ls-files`, and Kira owns
  no gitignore matcher (`docs/adr/0014-the-workbench-asks-git-what-to-hide.md#L24-L35`).
- **ADR 0015** — a chat's open files are the chat's; the pane's width is the
  window's (`docs/adr/0015-a-chats-open-files-are-the-chats.md#L12-L22`).
- **ADR 0016** — the workbench watches the levels it shows with `fs.watch`, no
  watcher dependency (`docs/adr/0016-the-workbench-watches-the-folder-it-shows.md#L14-L32`).
- **ADR 0026** — a ticket carries its pull requests; the connection is
  provider-agnostic, GitHub first; a link is claimed from the title and branch
  (`docs/adr/0026-a-ticket-carries-its-conversation-and-pull-requests.md#L23-L29`).
- **ADR 0029** — a repository is watched from a checkout, attached by its remote,
  and belongs to one project (`docs/adr/0029-a-repository-is-watched-from-a-checkout.md#L19-L25`).
- **`desktop-conventions.md`** — `workspace/` is "the disk itself", `ipc/` is handed
  what it needs and never imports `pi/`, and imports point one way
  (`docs/internal/desktop-conventions.md#L264-L298`). The same document says the
  preview "nothing here edits a file" (`#L145-L149`), which `ipc/files.ts`'s
  `write`/`create`/`upload` have since outgrown.
- **`CONTEXT.md`** — **Repository** is named by provider/owner/name and attached to
  one project, from a checkout (`CONTEXT.md` at repo root, `#L79-L83`); **Workbench**
  is the pane where a chat's own things are looked at (`#L85-L90`); a **Pull request
  link** is the current link on a ticket to the PR reviewing its work (`#L186-L188`).
  Nothing in the vocabulary gives a repository its own PR list, which is the tension
  §4.3 D names.

---

## 4. Gap analysis

### 4.1 Git surfaces

“Kira has” refers to production wiring, not exported-but-unused helpers. In this
table `routes.js`/`service.js`/`gitGraph.ts` are openchamber;
`workspace/git.ts`/`reading.ts` are Kira.

| openchamber surface | Backed by | Kira today | What Kira would need |
| --- | --- | --- | --- |
| status + changed marks | `GET /api/git/status` (`service.js#L2472-L2485`) | **has** — `changedByGit` for the tree only (`workspace/git.ts#L107-L124`) | a richer status (ahead/behind, index vs working, diff stats) or accept the tree's path list and read the rest separately |
| per-path diff | `GET /api/git/diff` (`routes.js#L383-L411`) | **none** | `workspace/` function (`git diff` / `git show`) + `file:diff`-shaped channel + bridge types; size-cap like `reading.ts#L13` |
| full-file before/after | `GET /api/git/file-diff` (`#L413-L445`) | **none** | same read path, new channel |
| stage / unstage (file and hunk) | `POST /api/git/stage|unstage|apply-hunk` (`#L543-L612`) | **none** | new main-process write + per-repo mutation queue + channel + optimistic renderer state |
| commit / commit & push | `POST /api/git/commit|push` (`#L630-L644`, `#L883-L906`) | **none** (clone/push only inside a run) | commit write; push reuses remote; new channel |
| revert file | `POST /api/git/revert` (`#L522-L541`) | **none** | write + channel |
| branches list | `GET /api/git/branches` (`#L908-L922`) | **partial** — `branchesOf` exists, unwired (`workspace/git.ts#L282-L295`) | wire it to a channel |
| checkout / create / rename / delete branch | `POST /api/git/checkout`, `/branches`, `PUT /branches/rename`, `DELETE /branches` | **none** | write + channel; dirty-tree guard (`DirtyBranchSwitchDialog`) |
| commit history | `GET /api/git/log` (`#L1330-L1352`) | **none** | `git log` read + channel; paging via `maxCount` |
| commit files / commit diff | `GET /api/git/commit-files|commit-diff` | **none** | read + channel (lazy per expanded row) |
| git graph | client `assignLanes` (`gitGraph.ts#L56-L181`) | **none** | pure client function once log exists; no server work |
| fetch / pull / push | `POST /api/git/fetch|pull|push` | **partial** — only inside a run's clone; no user-facing channel | write + channel + credential behaviour (machine credentials, `GIT_TERMINAL_PROMPT=0` analogue) |
| merge / rebase / abort / continue | `POST /api/git/merge|rebase` + `/abort` + `/continue` | **none** | write + conflict state + dialog; the largest single piece |
| stash list / push / apply / pop / drop | `GET/POST /api/git/stash*` | **none** | write + channel |
| conflict detail + "resolve with AI" | `GET /api/git/conflict-details` | **none** | read + write; the AI hook is an openchamber pattern that maps to Kira's chat |
| identity profiles | `GET/POST /api/git/identities`, `set-identity` | **none** | optional; Kira has no identity UI and no requirement |

Net: roughly a dozen new main-process git functions, one or two new channel groups,
one new bridge surface, and one new renderer view. The server is untouched for the
Git view — this is the whole point of the locked scope.

### 4.2 Pull Request surfaces

| openchamber surface | Backed by | Kira today | What Kira would need |
| --- | --- | --- | --- |
| PR status for a branch | `GET /api/github/pr/status` | **partial** — only mirrored rows by ticket (`GET /api/tickets/:ref/pull-requests`) | either a new server route that reads the host live, or render mirrored rows only |
| list PRs by repository | `GET /api/github/pulls/list` | **none** | new server route; but see the constraint below — Kira cannot list a repository's unlinked PRs from its tables |
| PR context (body, comments, files, diff, checks detail) | `GET /api/github/pulls/context` | **checks rollup only** (`pullRequestCheck`, `schema.ts#L603-L621`) | new host read + route + IPC channel + renderer; or a ticket-scoped subset |
| create PR | `POST /api/github/pr/create` | **none** | host write; needs a token/App act on the user's behalf |
| edit PR | `POST /api/github/pr/update` | **none** | host write |
| merge PR | `POST /api/github/pr/merge` | **none** — Kira observes a merge by webhook (`git.ts#L1183-L1201`) | host write, unless merges stay in the browser |
| mark ready | `POST /api/github/pr/ready` | **none** | host write (GraphQL on GitHub) |
| multi-account switcher | auth routes + `GitHubAccountControl` | **partial** — one connection per provider/instance (`gitConnection` unique index, `schema.ts#L514-L517`) | not ported unless multi-account is a requirement |

### 4.3 Hard constraints found

**A. The workbench is not read-only, and where a git write lives is already
decided by the folder rule.** `desktop-conventions.md` says the workspace preview
"nothing here edits a file" (`#L145-L149`), but `ipc/files.ts` and `reading.ts`
already write (`ipc/files.ts#L164-L197`, `reading.ts#L82-L101`). So a stage/commit
write is not a new class of capability. It belongs in **`workspace/`** — that folder
is defined as "a workspace on disk: git's exclusions, one folder at a time, reading
one file / writing one file" (`desktop-conventions.md#L272`), and the import rule is
that `ipc/` is *handed* the workspace functions rather than importing `pi/` or
anything else (`#L285-L298`). The constraint this creates is **naming**: `ipc/git.ts`
already means *Git host connections* (`apps/desktop/src/main/ipc/git.ts#L1-L8`), and
`GIT_CHANNELS` already means host channels (`bridge.ts#L691-L704`). A local Git view
cannot reuse either name. It needs either a differently-named channel group (say
`git-workspace:*` / `workspaceGit:*`) in its own file, or to extend the `file:*`
group. Mixing "which host is connected" with "stage this file" under one
`git:` namespace would make the two meanings indistinguishable in the bridge.

**B. `simple-git` is already the transport, and IPC is enough if diffs are capped.**
Kira and openchamber both spawn the same binary through the same package; there is no
new dependency and no second git (`workspace/git.ts#L10-L14`). openchamber does **not**
stream diffs — it sends whole JSON bodies (`routes.js#L383-L411`) and bounds the large
case with timeouts and caches (`HistoryCommitRow.tsx#L19-L22`). Kira's request/response
IPC therefore does not *need* streaming for v1, but it does need a **size cap and a
refusal sentence**, because a diff of a generated file can dwarf `reading.ts`'s 1 MB
text cap (`reading.ts#L13`). The revisit condition for streaming is a measured diff
that exceeds the cap often enough to matter.

**C. Index serialisation is the real missing mechanism.** The tree already refreshes
git status on every watcher burst (`listing.ts#L30-L33`, `watching.ts#L107-L147`) and
`git status` writes the index; a Git view stages and commits against the same index.
Without a per-repository mutation queue (openchamber's `service.js#L438-L464`) and a
status-read limiter (`service.js#L2469-L2485`), the two surfaces race and produce
`index.lock` failures and stale rows. This is more important than any individual verb.

**D. The PR view's scope is not answerable from Kira's tables for unlinked PRs.**
`ticketPullRequest` has a non-null `ticketId` and a nullable `repositoryId`
(`schema.ts#L564-L593`); the mirror only records a PR that names a ticket and ignores
one that does not (`git.ts#L1140-L1143`). ADR 0026 models PRs as a ticket's and
ADR 0029 models a repository as a project's, so the two natural scopes are:

- **List by ticket** (or by the workspace's project, joining ticket → PR): possible
  from existing rows today, but only ticket-linked PRs appear, and a PR opened
  without a `FND-12` reference is invisible until someone edits its title.
- **List by repository**: what a "Pull Requests view" beside a checkout most
  naturally means, and what openchamber does (`pulls/list` keyed by directory). But
  Kira has **no route** for it and the tables cannot answer "this repository's open
  PRs" for unlinked PRs; it would require a new outbound host read keyed by the
  project's repository (the connection/token model in `gitConnection`, and the
  `installationToken` → `githubInstallationRepositories` pattern at
  `git.ts#L1478-L1521` as the only precedent for calling a host).

If the PR view must show the repository's real PR list, the honest answer is a new
server route that calls the host through the project's repository + connection, not a
query over `ticketPullRequest`. That is a bigger piece than the Git view.

**E. Fork networks have no home in Kira's model.** openchamber finds a branch's PR by
expanding `origin` through GitHub's `parent`/`source` metadata
(`openchamber:packages/web/server/lib/github/repo/fork-detection.js#L60-L102`) and ranks remotes explicitly, tracking first,
origin/upstream next (`openchamber:packages/web/server/lib/github/DOCUMENTATION.md#L78-L91`). Kira's `remoteOf` reads one
remote, preferring `origin`, and refuses two remotes with no origin
(`workspace/git.ts#L200-L225`); `parseRemote` produces `{host, owner, name}` with no
parent (`#L166-L198`). A PR opened from a fork against an upstream is not something
Kira's current model can resolve, and `README`-level parity would need a fork concept
in `repository` or in the read route. This affects the PR view, not the Git view.

**F. What does not port, and the revisit condition for each.**

| openchamber feature | Why it does not port | Revisit if |
| --- | --- | --- |
| Multi-run/per-session **worktrees** and their bootstrap | Kira's `isolatedCheckout` is a one-shot worktree for a write-capable subagent (`workspace/git.ts#L30-L65`), not a session-lifetime worktree registry; ADR 0029's workspace is a folder someone opened | a run needs a persistent worktree per chat |
| **Integrate commits** (worktree → base cherry-pick) | only meaningful with the worktree model above | the worktree model lands |
| **VS Code / mobile / Capacitor** Git surfaces | separate runtimes and separate transports; this note's scope is the desktop app (`openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L159-L161`) | Kira grows a second shell |
| **i18n** (`useI18n`, `gitView.*` keys) | Kira writes user-facing words in one module per surface (`workCopy.ts` is the Work pattern, `desktop-conventions.md#L218-L221`) | never as a copy; follow Kira's copy rules |
| **Nested-repo discovery / picker** | Kira's tree already scopes to the chat's folder and reports whether git answered (ADR 0014); a nested repo under it is a different repo the folder's `ls-files` does not reach | a workspace is a subdirectory of a larger checkout and the person wants that repo's status |
| **Git identity profiles / ssh keys** | Kira clones and commits as the person, using machine credentials (`workspace/git.ts#L235-L251`) | a machine needs more than one identity |
| **Gitmoji / AI-generated commit messages** | product-specific; openchamber's is a large prompt path (`GitView.tsx#L103-L167`, `#L1264-L1310`) | Kira wants an agent to draft a commit message |
| **Remote removal, remote branch deletion, unpushed counts** | convenience, not core | asked for |
| **PR create/edit/merge/ready, multi-account, `gh` CLI** | host writes and a personal-token trust model; Kira's server owns host credentials sealed (`schema.ts#L488-L518`) | Kira decides to push/merge from the app |

---

## 5. What this means for Kira

**Git view — build it in `workspace/`, render it as a workbench view, and build the
queue first.** The ordered version:

1. **A per-repository git operation seam in `workspace/`.** Extend `git.ts` (or add
   files named for what they hold) with the read functions (`status` richer than
   `changedByGit`, `diff` for a path, `log`, `commitFiles`) and the write functions
   (`stage`, `unstage`, `commit`, `checkout`, `createBranch`…). Put a per-repository
   promise chain in front of every index mutation, and a bounded status-read limiter
   in front of `changedByGit`/the new status, copying the *shape* of
   `serial-refresh.js#L1-L93` and `service.js#L430-L464`. This is the one piece with
   no existing analogue in Kira.
2. **A channel group with a name that says local.** Not `git:*` — that is hosts
   (`ipc/git.ts`). Something like `workspace-git:*`, wired in
   `registerFileChannels`-style (`index.ts#L444-L512`) with handlers handed the
   workspace functions, matching `ipc/files.ts`'s shape (`ipc/files.ts#L80-L252`).
3. **Bridge types** in `preload/bridge.ts`: a `GitStatus`, a `GitDiff`, a `GitLog`
   and the write inputs, plus the `window.kira` methods. Writes must stay
   chat-scoped (`chatId` → workspace), the way `file:*` is (`bridge.ts#L1634-L1660`).
4. **A workbench view.** A new constant beside `WORKSPACE`/`BROWSER`
   (`workbenchTabs.ts#L16-L25`), a rail entry
   (`workbench.tsx#L179-L186`), a panel that reuses the stage/diff/commit sections
   the way openchamber's props-driven components do, and the
   `workbenchExplorer`-style CSS (`styles.css#L343-L383`).
5. **Graph last.** `assignLanes` (`gitGraph.ts#L56-L181`) is a pure function and can
   be lifted almost verbatim once log exists.

**Pull Requests view — decide scope before drawing anything.** Kira's server already
has the normalized PR shape and the ticket link; it lacks a repository-keyed read. The
smallest honest v1 is a **ticket/project-scoped list of mirrored PRs** (existing rows,
new route `GET /api/projects/:ref/pull-requests` or reuse `ticketPullRequest` joins),
rendered with the checks rollup Kira already stores. **Live host listing, PR
conversation, diff and create/merge are a second step** and require an outbound host
read keyed by repository + connection, with the fork gap (§4.3 E) called out. Because
the locked scope says the PR view "reads pull requests from the connected host / Kira
server", that step is likely in scope — which makes it a server deliverable, not a
renderer one.

**Order of work.** Git view first: it is self-contained in `workspace/` + `ipc/` +
`renderer/`, touches no server route, and its hard part (the mutation queue) is a
small, testable module. The PR view's hard part is a server route and a decision about
unlinked PRs, and it does not block anything in the Git view.

---

## Left unverified

- **No measurement of diff size on a real checkout.** openchamber's 1 MB/500-line
  thresholds and timeouts (`HistoryCommitRow.tsx#L19-L22`) are read, not measured
  against Kira's repositories. Whether Kira needs a stream depends on that.
- **Whether `git status` in `changedByGit` actually contends with a stage in
  practice.** The `index.lock` risk is inferred from `git status`'s documented index
  refresh and openchamber's two queues; I did not reproduce a collision.
- **Whether openchamber's `gitIndexMutationQueue` optimistic rollback is necessary
  for Kira's smaller UI.** It may be enough to disable the affected row while the
  mutation is in flight.
- **What Kira's connection can actually read for a repository.** The server can mint
  an installation token (`git.ts#L1478-L1521`), but there is no code that lists a
  repository's PRs, and whether a token connection has the right scope is unread.
- **The `branchesOf` dead-code claim.** Grep shows only tests reference it; I did not
  run a bundler to prove it is unreachable.
- **VS Code/mobile divergence beyond the documentation.** I read the documentation's
  statements (`openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L97`,
  `openchamber:packages/web/server/lib/git/DOCUMENTATION.md#L159-L161`) and the filenames, not the
  VS Code implementation.

## Open questions for the grill

1. **What answers the PR view: mirrored ticket-linked rows, or a new live host
   read?** This decides whether the PR deliverable is a renderer-only ticket surface
   or a new server route over `git_connection` + `repository` with outbound calls.
   The locked scope ("reads pull requests from the connected host / Kira server")
   leans to the second, but the tables cannot answer unlinked PRs (§4.3 D).
2. **Does the Git view show history and branches in v1, or only status/diff/stage/
   commit?** The queue and read path are the expensive part; log/branch/merge/stash
   are additive. A v1 of "status, diff, stage, commit" is roughly half the surface
   list.
3. **Where does the local-git channel live, given `git:*` already means hosts?** Name
   it (`workspace-git:*`, extend `file:*`, or rename the host channels), because the
   bridge's one-word-one-meaning rule (`desktop-conventions.md#L315-L323`) makes two
   meanings under `git:` a bug waiting to happen.

### Next action

Decide question 1 with the owner: does the Pull Requests view read live hosts, or
mirrored ticket rows? Everything in §4.3 D and §5 follows from that answer.
