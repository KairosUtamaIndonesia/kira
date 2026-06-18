# Implementation Plan: Thread Tree Navigation

## Overview

Add tree-based navigation to the desktop agent thread panel — users can browse the conversation history as a tree, click any past node to scroll there, edit a past message to fork the conversation, and (in cowork mode) see branches of their conversation as named forks.

The Pi session manager already stores conversations as a tree (`SessionManager.getTree()` → `SessionTreeNode[]`) and accepts `navigate_tree` RPC to fork; the desktop WebSocket transport already proxies it. The frontend currently renders a flat transcript and has no tree awareness. This plan fills that gap.

## Architecture Decisions

- **DECISION 1: Tree is fetched via HTTP, not derived from events.** The Pi session's `getTree()` is authoritative. Add a new `GET /agent-threads/:threadId/tree` endpoint that returns `SessionTreeNode[]` serialized as JSON. The frontend fetches it on panel mount and polls/re-fetches after significant events (message_end, compaction). **Rationale:** Deriving tree from the event stream duplicates Pi's logic and misses entries that were never streamed (compacted summaries, labels, branch metadata).

- **DECISION 2: Tree is a panel, not a sidebar overlay.** A new `AgentThreadTreePanel` component lives as a **collapsible side panel inside the AgentThreadPanel** (not a shell-wide sidebar). It slides in/out via a toggle button in the panel header. **Rationale:** The tree is contextual to one thread. A shell-wide sidebar (like the Explorer) would be wrong for per-thread state. A split-panel inside the thread panel is the right boundary.

- **DECISION 3: Edit-a-past-message flow:** clicking a user-message node in the tree and hitting E or clicking an "Edit" action opens an inline editor (reusing the Composer component). Submit sends `navigate_tree(targetId)` to fork, then `prompt(message)`. The transcript's `persistedMessages` array is trimmed to only show messages on the active path (messages with `parentId` ancestors that match the current leaf's path). **Rationale:** `navigate_tree` forks by returning the session to that branch point, logically replacing the subsequent context. The transcript must reflect this by removing messages that are no longer on the active path.

- **DECISION 4: Cowork fork view is a simplified presentation layer on the same tree.** Cowork users see branches as named tabs (like browser tabs) at the top of the chat, not a visible tree. The "edit" action triggers within the composer. The backend distinguishes cowork vs dev by thread context, but the tree API is identical. **Rationale:** Building two separate tree sessions for dev vs cowork duplicates all infrastructure. The cowork difference is purely UI — no visible tree widget, just a branch picker.

- **DECISION 5: PiTranscriptState gains tree fields.** Add `treeNodes: SessionTreeNode[] | undefined`, `activePath: string[]` (ordered node IDs from root to current leaf), and `activeLeafId: string`. The reducer handles a new `"tree_updated"` event to replace `treeNodes`, and `applyMessageEnd` / `message_start` update `activePath` when the new leaf has a different parent than the previous leaf. **Rationale:** The transcript loop (`buildAgentThreadTranscript`) needs the tree to skip messages not on `activePath`. Deriving this from the tree fetch result, not from events, would require the tree to have been fetched first — making race conditions likely.

- **DECISION 6: Virtual scrolling.** Trees can be 500+ nodes. The tree panel uses `react-virtuoso` (already a peer dep via dockview contextual deps? — check; if not, use a lightweight virtualizer like `@tanstack/react-virtual` which is already in the monorepo via `@tanstack/react-router`). **Rationale:** Rendering 500 tree nodes with expand/collapse state in DOM without virtualization would be unacceptably slow.

## API Changes

### agent-pi (backend)

New HTTP endpoint:

```
GET /app/agent-threads/:threadId/tree
→ { nodes: SessionTreeNodeJson[], currentLeafId: string }
```

SessionTreeNodeJson serialized as:

```typescript
type SessionTreeNodeJson = {
  id: string;
  parentId: string | null;
  entry: {
    type: "message" | "tool_call" | "thinking" | "compaction" | "label" | "custom" | …;
    role?: "user" | "assistant";
    text?: string;  // truncated preview
    toolName?: string;
    timestamp?: string;
    label?: string;
  };
  children: SessionTreeNodeJson[];
};
```

### PiTranscriptState (frontend types)

Add to `PiTranscriptState`:

```typescript
type PiTranscriptState = {
  // existing fields
  persistedMessages: PiMessage[];
  activeAssistantTurn: PiActiveAssistantTurn | undefined;
  activeToolExecutions: Record<string, PiToolExecutionState>;
  activeToolUiRequests: Record<string, PiToolUiRequestState>;
  liveEvents: PiEvent[];

  // NEW
  treeNodes: SessionTreeNodeJson[] | undefined;
  activePath: string[]; // ordered node IDs root→leaf
  activeLeafId: string | undefined; // current tail of activePath
  branchParentId: string | undefined; // the tree node ID at which the current
  // branch diverges from parent (for fork indicator)
};
```

## Task List

### Phase 1: Foundation — Fetch and display tree data

#### Task 1.1: Add tree HTTP endpoint to agent-pi

**Description:** Add `GET /app/agent-threads/:threadId/tree` that calls `SessionManager.getTree()` and serializes the result. Include the current leaf ID from the session.

**Acceptance criteria:**

- [ ] New route returns `{ nodes: SessionTreeNodeJson[], currentLeafId: string }`
- [ ] `SessionTreeNodeJson` matches the serialization schema above
- [ ] Route returns 404 for unknown threadId
- [ ] Route returns 401 without valid token
- [ ] `sessionManager.getTree()` is already public — no infra changes needed

**Verification:**

- [ ] `curl` against local agent-pi returns valid JSON tree
- [ ] Tree includes all entries including compaction summaries

**Dependencies:** None

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/app-routes.ts`

**Estimated scope:** Small (1 file)

#### Task 1.2: Fetch tree on panel mount and after key events

**Description:** In `useAgentThreadConnection`, add a `treeFetcher` that calls the new HTTP endpoint. Fetch on mount. Re-fetch after `message_end`, `turn_end`, and `settled` events (debounced 500ms). Store in a new `treeNodes` + `activePath` + `activeLeafId` state.

**Acceptance criteria:**

- [ ] Tree is fetched when panel mounts (after `ready` state)
- [ ] Tree is re-fetched after each message_end/turn_end (debounced)
- [ ] `treeNodes` is `undefined` while loading
- [ ] `activePath` is computed from `currentLeafId`: walk up parent chain to root
- [ ] Error is silently logged (tree is a UI enhancement, not critical)

**Verification:**

- [ ] Open a thread with existing conversation → tree loads
- [ ] Send a new prompt → tree updates after assistant responds

**Dependencies:** Task 1.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/hooks/useAgentThreadConnection.ts`
- `apps/desktop/src/features/agent-thread/api/agentRuntimeApi.ts`
- `apps/desktop/src/features/agent-thread/types.ts`

**Estimated scope:** Medium (3-4 files)

### Checkpoint: Tree Data Flows

- [ ] `curl` endpoint returns valid tree for any thread
- [ ] Frontend fetches tree on mount
- [ ] Frontend re-fetches after new assistant turns
- [ ] `treeNodes`, `activePath`, `activeLeafId` are populated in hook consumers

#### Task 1.3: Extend PiTranscriptState reducer with tree awareness

**Description:** Add tree fields to `PiTranscriptState`. Teach `applyPiEvent` a new `"tree_updated"` event type that replaces `treeNodes`. When `message_end` or `turn_end` fires and the message's `id` or `parentId` differs from `activeLeafId`, the reducer detects a branch fork and updates `activePath` / `activeLeafId`. Add a helper `isOnActivePath(message: PiMessage): boolean` that checks if the message's ancestors match the current active path.

**Acceptance criteria:**

- [ ] `emptyPiTranscriptState` includes `treeNodes: undefined`, `activePath: []`, `activeLeafId: undefined`, `branchParentId: undefined`
- [ ] `tree_updated` event replaces `treeNodes`, recomputes `activePath`
- [ ] `message_end` with new `parentId` that matches `activeLeafId` → append to activePath
- [ ] `message_end` with `parentId` that does NOT match `activeLeafId` → discard (off-path message)
- [ ] Messages with `id`s that are not on the active path are filtered out of `persistedMessages` during `buildAgentThreadTranscript` (or filtered at the hook level)

**Verification:**

- [ ] Unit test: appendLocalUserMessage → tree fields survive round-trip
- [ ] Unit test: message_end on a branching parentId drops the old leaf's messages
- [ ] Unit test: message_end on active path appends expected message

**Dependencies:** Task 1.2

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/piTranscriptState.ts`
- `apps/desktop/src/features/agent-thread/types.ts`
- `apps/desktop/src/features/agent-thread/agentThreadDisplay.ts`

**Estimated scope:** Medium (3 files)

### Phase 2: Tree UI Component

#### Task 2.1: Build SessionTree React component

**Description:** A new component `SessionTree` that renders `SessionTreeNodeJson[]` as an interactive tree. Each node shows:

- Indentation + connector lines (├──, └──, │)
- Collapse/expand chevron if node has children
- Entry type icon (user message → person icon, assistant → brain, tool_call → terminal, etc.)
- Truncated text preview (first 80 chars of text)
- Label badge if node has a label
- Active path highlighting (bold/blue background for nodes on activePath)

**✅ Confirmed: Labels are supported natively.** `SessionManager.appendLabelChange(targetId, label)` persists `LabelEntry` in the session JSONL. `SessionTreeNode.label` propagates into `getTree()`. The current WS transport does NOT proxy `set_label` yet — will add as a small command handler. No separate label storage needed.

**✅ Confirmed: No virtualizer dep loaded.** Neither `react-virtuoso` nor `@tanstack/react-virtual` is in `apps/desktop/package.json`. Add `react-virtuoso` or `@tanstack/react-virtual` as a dep in Task 2.1.
Supports:

- Click chevron to expand/collapse children
- Click node body to select it
- Active node is highlighted
- Keyboard: Up/Down to navigate, Left/Right to collapse/expand, Enter to select

**Acceptance criteria:**

- [ ] Tree renders with correct indentation and connectors
- [ ] All 8 entry types have distinct icons (user, assistant, tool_call, thinking, compaction, label, custom, system)
- [ ] Clicking chevron toggles children visibility
- [ ] Clicking node body sets it as selected
- [ ] Active path nodes have visible highlight (bg highlight)
- [ ] Nodes with no display text show truncated type-appropriate placeholder
- [ ] Tree supports up to 500 nodes without frame drops (virtualized list)

**Verification:**

- [ ] Open a thread with multi-turn conversation → tree shows all entries
- [ ] Expand/collapse works on nested branches
- [ ] Active path shows the current leaf highlighted
- [ ] Select a node → it's visually distinct

**Dependencies:** Task 1.3

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx` (new)
- `apps/desktop/src/features/agent-thread/components/tree/` (new directory, split if >200 lines)

**Estimated scope:** Medium (1-2 new files, ~300 lines)

#### Task 2.2: Integrate SessionTree as collapsible panel within AgentThreadPanel

**Description:** Add a toggle button to the AgentThreadPanel header/section that slides the tree in from the left as a narrow panel (300px). Uses a ResizablePanel / side-by-side layout within the thread panel. The tree and transcript share vertical space when visible.

**Acceptance criteria:**

- [ ] Button in thread panel header toggles tree visibility
- [ ] Tree panel is 300px wide when visible
- [ ] Tree panel is resizable (min 200px, max 500px)
- [ ] Tree visibility state persists within the component (not persisted to workspace layout)
- [ ] Transcript width adjusts when tree opens/closes
- [ ] No layout shift or jank during toggle

**Verification:**

- [ ] Click toggle → tree appears, transcript shrinks
- [ ] Click toggle again → tree disappears, transcript fills width
- [ ] Drag handle to resize tree
- [ ] Works across thread panel re-opens

**Dependencies:** Task 2.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/AgentThreadPanel.tsx`
- `apps/desktop/src/features/agent-thread/components/AgentThreadTranscript.tsx` (minor CSS)

**Estimated scope:** Small (2 files)

### Checkpoint: Tree UI Visible

- [ ] Tree renders and is interactive
- [ ] Toggle button opens/closes tree panel
- [ ] Active path highlights correctly
- [ ] Transcript renders only messages on active path

### Phase 3: Tree-Transcript Scroll Sync & Navigation

#### Task 3.1: Scroll transcript to selected tree node

**Description:** When a tree node is selected, scroll the transcript so the corresponding message is visible. This requires `treeNodeId → DOM element` mapping. Assign `data-message-id` attributes to each transcript item. On tree node click, find the DOM element with `[data-message-id="${nodeId}"]` and `scrollIntoView()`.

**Acceptance criteria:**

- [ ] Each transcript item has a `data-message-id` attribute matching the tree node id
- [ ] Clicking a user message node in the tree scrolls the transcript to that message
- [ ] Clicking an assistant turn node scrolls to that turn
- [ ] Clicking a tool call node scrolls to the tool call block within the assistant turn
- [ ] Reverse: when transcript auto-scrolls (streaming), the tree's active path updates

**Verification:**

- [ ] Click a past user message → transcript scrolls to it
- [ ] Click a tool call in the tree → transcript scrolls to the tool call block
- [ ] Live tail streaming continues to scroll transcript down, and active path follows

**Dependencies:** Tasks 1.3, 2.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx`
- `apps/desktop/src/features/agent-thread/components/AgentThreadTranscript.tsx`
- `apps/desktop/src/features/agent-thread/components/AgentThreadPanel.tsx`

**Estimated scope:** Small (3 files)

#### Task 3.2: Keyboard navigation in the tree

**Description:** When the tree panel has focus, arrow keys navigate:

- Up/Down: move selection to previous/next visible node
- Left: collapse current node (if expanded) or move to parent
- Right: expand current node (if collapsed and has children) or move to first child
- Enter: jump transcript to selected node (same as click)

**Acceptance criteria:**

- [ ] Up/Down navigate visible nodes, skipping hidden children of collapsed nodes
- [ ] Left collapses node or moves to parent
- [ ] Right expands node or moves to first child
- [ ] Enter scrolls transcript to the node
- [ ] Focus indicator is visible (focus-visible ring)
- [ ] Tab moves focus between tree and composer/transcript

**Verification:**

- [ ] Arrow keys navigate tree
- [ ] Expand/collapse via keyboard works
- [ ] Tab out of tree and back in

**Dependencies:** Task 2.1, 3.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx`

**Estimated scope:** Small (1 file)

### Phase 4: Edit-a-Past-Message (Fork)

#### Task 4.1: Add "Edit" action to user message tree nodes

**Description:** User messages in the tree show an "Edit" button on hover (or when selected + hitting E). Clicking it opens an inline editor that replaces the composer area with a pre-filled textarea showing the original message text. Submitting calls:

1. `navigate_tree(targetId)` via WS command
2. Wait for response
3. `prompt(editedMessage)` via WS command

The transcript state must handle this: after `navigate_tree` succeeds, the frontend needs to know it's now on a different branch. The WS transport already proxies `navigate_tree`; the frontend `PiAgentSocket` needs a `navigateTree(targetId)` method.

**Acceptance criteria:**

- [ ] User message nodes in tree have a hover-visible "Edit" label/button
- [ ] Clicking "Edit" opens an inline editor with the message text pre-filled
- [ ] The composer area is replaced by the edit view while editing
- [ ] Pressing Escape cancels editing, restores composer
- [ ] Submit sends navigate_tree then prompt over the WS
- [ ] After fork, transcript shows the new response (old future messages hidden)
- [ ] The tree panel re-fetches after fork to show the new branch
- [ ] Tree shows a visual "fork point" indicator where the branch diverged

**Verification:**

- [ ] Edit a past user message → new assistant response appears
- [ ] Old messages after the edited point are hidden from transcript
- [ ] Tree shows the fork point and new branch
- [ ] Can collapse the old branch in the tree

**Dependencies:** Tasks 1.1, 1.2, 1.3, 3.1

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/ws-transport.ts` (add navigate_tree command handler in frontend socket)
- `apps/desktop/src/features/agent-thread/hooks/useAgentThreadConnection.ts`
- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx`
- `apps/desktop/src/features/agent-thread/components/Composer.tsx`

**Estimated scope:** Medium (4 files)

### Checkpoint: Branching Works

- [ ] Edit a past message → new branch in tree
- [ ] New assistant response appears in transcript
- [ ] Old branch messages are hidden
- [ ] Can see fork point in tree

### Phase 5: Labeling & Filtering

#### Task 5.1: Inline label editing on tree nodes

**Description:** Right-click (or Shift+Enter on selected node) opens a small text input to set/reset a label on a tree node. Sends a `label` command over WS to persist the label in the Pi session. Tree shows label badge on labeled nodes.

**Acceptance criteria:**

- [ ] Right-click on any tree node shows "Add label" / "Edit label" context menu item
- [ ] Clicking it opens a small inline input
- [ ] Submitting sends label via WS and re-fetches tree
- [ ] Tree node shows label badge with first 25 chars
- [ ] Clearing the label removes the badge
- [ ] Labels survive page refresh (persisted in Pi session JSONL)

**Verification:**

- [ ] Label a node → badge appears on that node
- [ ] Refresh the thread panel → label still visible
- [ ] Clear the label → badge disappears

**Dependencies:** Task 2.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx`
- `apps/desktop/src/features/agent-thread/hooks/useAgentThreadConnection.ts` (add `labelTreeEntry` WS command)

**Estimated scope:** Small (2 files)

#### Task 5.2: Tree filter controls

**Description:** A filter bar above the tree with toggle buttons: "All", "No tools" (hide tool call nodes), "User only" (hide everything except user messages), "Labeled only" (show only labeled nodes). Filters animate: hidden nodes fade, expanding the tree accordingly.

**Acceptance criteria:**

- [ ] Filter bar with 4 toggle buttons visible above tree
- [ ] "All" shows everything (default)
- [ ] "No tools" hides tool call nodes (their children promoted to parent level)
- [ ] "User only" shows only user message nodes
- [ ] "Labeled only" shows only nodes with a label
- [ ] Active filter has a visual indicator
- [ ] Filter state persists for the panel session

**Verification:**

- [ ] Enable "No tools" → tree collapses all tool nodes
- [ ] Enable "User only" → tree shows only user messages
- [ ] Enable "Labeled only" with no labels → tree shows nothing (with empty state message)
- [ ] Toggle back to "All" → full tree restored

**Dependencies:** Task 2.1

**Files likely touched:**

- `apps/desktop/src/features/agent-thread/components/tree/TreeFilterBar.tsx` (new)
- `apps/desktop/src/features/agent-thread/components/SessionTree.tsx`

**Estimated scope:** Small (2 files)

### Phase 6: Cowork Fork View (Simplification)

#### Task 6.1: Cowork branch picker + hover edit/resend buttons

**Description:** In the Cowork chat view header, show a branch picker dropdown listing all branches in the current tree. Past user messages in the transcript show **Edit** and **Resend** buttons on hover. Edit opens the inline editor (same as Task 4.1). Resend immediately calls `navigate_tree(targetId)` then `prompt(originalMessage)` — effectively replaying the same prompt at that tree position, forking the conversation. Code mode also gets the same hover buttons on user messages (in addition to the full tree sidebar from Tasks 2.1–3.2).

**Acceptance criteria:**

- [ ] Cowork chat header shows current branch name (default: "main" or first label)
- [ ] Dropdown lists all branch-starting nodes by label or timestamp
- [ ] No visible tree widget in cowork — only the branch picker
- [ ] Switching branches loads the correct transcript
- [ ] Past user messages show **Edit** and **Resend** on hover (both cowork and code mode)
- [ ] Clicking Resend → navigate_tree + prompt(original) → new branch appears
- [ ] Clicking Edit opens inline editor (same as Task 4.1)
- [ ] Code mode transcript gets the same hover buttons (edit/resend) in addition to the tree sidebar

**Verification:**

- [ ] In a cowork session, make a few exchanges → one branch
- [ ] Edit a past message → new branch appears in picker
- [ ] Switch branches → transcript updates
- [ ] Hover a past user message → Edit + Resend buttons appear
- [ ] Click Resend → new assistant response starts

**Dependencies:** Tasks 1.1, 1.2, 1.3, 4.1

**Files likely touched:**

- `apps/desktop/src/features/app-shell/components/cowork/CoworkShell.tsx`
- `apps/desktop/src/features/app-shell/components/cowork/ChatView.tsx` (new or extract from CoworkShell)
- `apps/desktop/src/features/agent-thread/components/AgentThreadTranscript.tsx` (hover buttons)
- `apps/desktop/src/features/agent-thread/hooks/useAgentThreadConnection.ts`

**Estimated scope:** Medium (4 files)

## Decisions (from review)

- **Label endpoint**: WS command (`set_label`), not HTTP. Consistent with existing command handlers.
- **Tree open on thread open**: Closed by default. Tooltip on toggle button explains what it is.
- **Cowork surface**: Branch picker dropdown (no tree widget). User message hover reveals **Edit** and **Resend** buttons. Code mode gets the same hover buttons PLUS the full collapsible tree sidebar. Resend = fork from that message with no edits (same as edit but submit immediately).
- **Virtualizer**: `@tanstack/react-virtual`. Lighter weight, sufficient for flat expanded-list virtualization.

## Open Questions

- None resolved. Ready for execution.

## Risks and Mitigations

| Risk                                                                                       | Impact                               | Mitigation                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate_tree` forks create a new JSONL file, but old WS session still points at old leaf | High — transcript shows stale branch | Frontend must re-fetch the `/session` endpoint after navigate_tree completes to get the new leaf's messages, then re-hydrate PiTranscriptState |
| Pi doesn't support label WS command                                                        | Low                                  | ✅ Already confirmed: `SessionManager.appendLabelChange()` exists — just needs a command handler                                               |
| 500+ node tree is too large for HTTP                                                       | Low if truncated                     | Tree endpoint truncates text to 200 chars; full fetch is <50KB compressed                                                                      |
| Cowork "branches" collide with dev branches on same Pi session                             | Low                                  | Cowork threads already use separate project IDs and thread IDs; no collision                                                                   |
