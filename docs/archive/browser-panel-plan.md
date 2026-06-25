# Browser Panel + Element Selector — Plan

Adapt Orca's (`~/Workspaces/proto-kira`) "open websites in tabs" + "element selector"
features to Kira's Tauri stack.

## 1. What Orca does (source of the idea)

Orca is an **Electron** app. Its browser feature has two parts:

1. **Browser tabs** — each tab embeds a live website. Implemented with Electron
   `<webview>` / `WebContentsView` and driven over **CDP** (Chrome DevTools Protocol)
   for viewport emulation, screencast, cookies, request interception.
   Core renderer: `src/renderer/src/components/browser-pane/BrowserPane.tsx` (191 KB),
   `webview-registry.ts`; main process: `src/main/browser/*`.
2. **Element Selector** ("grab mode") — user arms a picker, hovers/clicks an element on
   the live page, and Orca extracts a structured payload (selector, a11y, computed
   styles, text, nearby context, screenshot) to copy or attach to an AI chat.
   - Renderer state machine: `useGrabMode.ts` (`idle → armed → awaiting → confirming`).
   - Injected guest overlay: `src/main/browser/grab-guest-script.ts` — a self-contained
     JS string injected into the page via `executeJavaScript()`; draws a hover overlay,
     resolves on click, extracts the payload, tears itself down.
   - Confirmation UI: `GrabConfirmationSheet.tsx`; payload contract:
     `src/shared/browser-grab-types.ts` (`BrowserGrabPayload`, budgets, secret redaction,
     attribute allowlist).

## 2. The core adaptation problem (Electron → Tauri)

Electron gives Orca two things Tauri does **not** give for free:

- **In-DOM embedding**: Electron `<webview>` is a DOM element that lays out inside the
  React tree automatically. Tauri has no DOM webview element.
- **CDP**: deep automation/inspection of the embedded page. Tauri exposes none of this.

In Tauri 2 the only way to embed a live third-party site inside the app window is a
**native child webview** added to the window with explicit pixel bounds. It floats
**above** the DOM; it does not participate in DOM layout. This changes the architecture:

- The React **Browser Panel** renders only chrome (address bar, toolbar, a placeholder
  region). A **native child webview** is positioned over that placeholder region and is
  kept in sync as the panel resizes/moves/activates.
- The Element Selector cannot use CDP. Instead it is injected as an
  **initialization script** that runs inside the page and posts results back over Tauri's
  raw IPC. This is a direct port of Orca's `grab-guest-script.ts` string (which already
  assumes "no preload, no Node, runs in the page's own world" — exactly our constraint).

## 3. Tauri 2 capabilities (verified)

- **Multiple child webviews per window**: `window.add_child(WebviewBuilder, position, size)`.
  Gated behind the **`unstable`** Cargo feature on the `tauri` crate.
  Refs: tauri-apps/tauri issues #11452 (`add_child`), #10011 (multiple webviews), #10518,
  #11126.
- **Remote URL**: `WebviewUrl::External(url)` loads an arbitrary site.
- **Init script on remote pages**: `WebviewBuilder::initialization_script(js)` runs in the
  page's world on each navigation — this is our injection vector for the selector overlay.
- **Page → Rust bridge**: Tauri has **no `WebviewBuilder::on_ipc`** and does **not** inject
  `window.__TAURI__` / `window.ipc` into external URLs (tauri-apps/tauri #5088) — the earlier
  draft was wrong (that was wry's API). The working bridge, proven in the Phase 1 spike, is
  **navigation interception**: the injected script assigns `location.href` to a sentinel
  scheme (`kira-select://…`) and `WebviewBuilder::on_navigation` returns `false` to cancel the
  navigation and reads the payload off the URL. (Phase 2 also uses `on_navigation` for
  address-bar sync and `on_document_title_changed` for the tab title.) The injected script
  must defer any sentinel navigation until the page's `load` event — a sentinel fired during
  load aborts the real page load.
- **Hide/show**: `Webview::hide()` / `show()` exist and work in 2.11.2, so the panel hides its
  webview on tab switch instead of the offscreen-reposition hack the earlier draft assumed
  (issue #11126 is resolved in this version). `navigate`, `reload`, `set_position`, `set_size`,
  `close` are also native `Webview` methods.
- **Threading**: every webview command MUST be an `async` Tauri command — a sync command runs
  on the main thread and `add_child`/dispatch deadlock on Windows WebView2 (crate docs,
  `webview/mod.rs`). Proven in the spike.
- **Rust → page JS**: `webview.eval(script)` runs JS imperatively (arm/cancel the selector).
- **Rust → frontend events**: `app.emit("browser://<panelId>", event)` pushes navigation/title
  events to the main webview, mirroring the existing `Channel`-based terminal pattern.

### Known Tauri friction (real risks — must design around)

- **No first-class hide/show for child webviews** (#11126 is an open feature request).
  When the Browser Panel is not the active dockview panel, we must move the child webview
  off-screen or resize it to 0×0 (and restore on activation). There is no `setVisible`.
- **White-on-load** for freshly added webviews (#10011) — needs a ready/first-paint gate
  before revealing.
- **Positioning quirks** with title-bar offset (#11452) — bounds math must account for the
  window's content origin; Kira uses `"decorations": false`, which simplifies this.
- Child webviews are always **above** the DOM, so React overlays that must sit on top of
  the page (e.g. the selector confirmation sheet) require either shrinking/hiding the page
  webview while shown, or rendering the overlay inside the page (the selector overlay is
  injected into the page, so that part is fine).

## 4. Decision (accepted)

**Adopt the Tauri `unstable` feature** to get multi-webview. Approved and recorded in
`docs/adr/0004-tauri-unstable-multiwebview-browser-panel.md`. The `tauri` dependency is
pinned to the exact resolved patch (`2.11.2`) so an `unstable` API change cannot land via
an unattended minor bump, and all multi-webview calls are confined to the backend
`browser` module.
Rejected alternatives (see ADR 0004):

- `<iframe>` in the React app — blocked by `X-Frame-Options`/`frame-ancestors` on most
  real sites, and same-origin policy prevents the selector from reading cross-origin DOM.
  Non-starter for "open any website".
- Separate `WebviewWindow` per site — not embeddable as a Panel; breaks the docking model.

## 5. Domain language

Per `docs/domain-language.md`, "Panel" is canonical and "Tab" is avoided for docking
surfaces. New terms to add (with approval):

- **Browser Panel** — a workspace panel that embeds and controls a live website.
- **Browser View** — the backend-owned native child webview connected to one Browser Panel
  by a stable id (mirrors "Terminal Session" ↔ "Terminal Panel").
- **Element Selector** — the in-page pick/extract flow producing an **Element Capture**.
- **Element Capture** — the structured payload extracted from a selected element.

## 6. Architecture

```
┌─ React (main webview) ─────────────────────────────┐
│ BrowserPanel.tsx (dockview component)              │
│   - address bar / toolbar (DOM)                    │
│   - placeholder region  ◄── ResizeObserver ──┐     │
│   - ElementCaptureSheet (DOM, shown when      │     │
│     selector resolves; page webview shrinks)  │     │
└───────────────────────────────────────────────┼─────┘
        invoke(browser_*)        emit(events)    │ bounds
              │                      ▲            ▼
┌─ Rust (browser.rs) ───────────────┼──────────────────┐
│ BrowserRegistry (managed state)   │                  │
│   id → BrowserView { webview, url, title, … }        │
│   commands: create / navigate / set_bounds /         │
│     set_visible(offscreen) / back / forward /        │
│     reload / set_selector_mode / close               │
│   on_ipc: receive Element Capture + nav events       │
│   init script: grab-guest-script (ported)            │
└──────────────────────────────────────────────────────┘
                     │ add_child / eval
                     ▼
        Native child webview → External(url)
```

Bounds-sync is the heartbeat: the placeholder region's screen rect (from a
`ResizeObserver` + dockview panel `onDidVisibilityChange`/`onDidActiveChange`) drives
`browser_set_bounds`. When the panel is hidden/inactive, push the webview off-screen.

## 7. File-by-file changes

### Backend (`apps/desktop/src-tauri/`)

- `Cargo.toml`: `tauri = { version = "=2.11.2", features = ["unstable"] }` (exact pin, done).
- `src/browser.rs` (**implemented in Phase 2**): no registry — Tauri's webview manager is the
  source of truth, so webviews are looked up by a deterministic label `browser-<panelId>`
  (`app.get_webview(label)`). `thiserror` `BrowserError`, camelCase DTOs, and `async`
  `#[tauri::command]`s:
  - `browser_panel_open { panelId, url, bounds }` → if the webview exists, `show()` +
    reposition (re-activated panel); else `window.add_child(WebviewBuilder::new(label,
External(url)).on_navigation(emit nav).on_document_title_changed(emit title), pos, size)`.
  - `browser_panel_navigate { panelId, url }`, `browser_panel_reload`,
    `browser_panel_go_back` / `go_forward` (via `eval("history.back()/forward()")`).
  - `browser_panel_set_bounds { panelId, bounds }`, `browser_panel_hide { panelId }`.
  - `browser_panel_close { panelId }`; `browser_close_orphans { keepPanelIds }` closes
    `browser-`prefixed webviews left over from a previously open Session (called on workspace
    mount).
  - Phase 3 adds `browser_panel_set_selector_mode { panelId, enabled }` → `eval(ARM|TEARDOWN)`
    and the selector init script + sentinel-scheme capture handling.
- `src/lib.rs`: `mod browser;` + every `browser_*` command registered in `generate_handler!`.
  No managed state needed.
- Persistence (`projects.rs` + migration `0012_browser_panels.sql`): `browser` panel kind +
  `browser_panel_state(panel_id, url)`, `workspace_browser_panel_create`,
  `workspace_browser_panel_url_update` (persists the last URL on each navigation).
- No capability changes: app commands aren't capability-gated (matches `terminal_*`), and the
  child webview label is in no capability `windows` list, so the remote page gets zero Tauri
  permissions.

### Frontend (`apps/desktop/src/features/`)

New feature folder `features/browser/` (feature-local ownership, per AGENTS.md):

- `types.ts`: `ElementCapturePayload` (port of `browser-grab-types.ts` — keep budgets,
  secret patterns, attribute allowlist), `BrowserView` events.
- `api/browserApi.ts`: typed wrappers over `invoke("browser_*")` + an `emit` listener
  helper (mirror `projectsApi`/terminal `Channel` usage).
- `components/BrowserPanel.tsx`: dockview panel — address bar, toolbar, placeholder ref,
  `ResizeObserver` → `browser_set_bounds`, visibility/active wiring → `browser_set_offscreen`,
  lifecycle create/close, event subscription for nav/title (updates panel title).
- `components/BrowserAddressBar.tsx`: URL input + nav buttons (trim down Orca's).
- `useElementSelector.ts`: port of `useGrabMode.ts` state machine, retargeted to
  `browser_set_selector_mode` + `browser://<id>` capture events.
- `components/ElementCaptureSheet.tsx`: port of `GrabConfirmationSheet.tsx` +
  `formatGrabPayloadAsText`. Two output actions: a **Copy** button (capture text →
  clipboard) and a **Send to Agent Thread** picker (see §8.1).
- `components/AgentThreadPicker.tsx`: lists currently open Agent Threads with live status;
  selecting one routes the capture into that thread. Lives in `features/browser/` but reads
  the Agent Thread feature's public selectors (no reach-in).
- `index.ts`: barrel export.

### Workspace integration (`apps/desktop/src/features/`)

- `projects/types.ts`: add `BrowserWorkspacePanel` to the `WorkspacePanel` union + its
  `BrowserPanelState { url }`, `CreateBrowserPanelInput`. The union is consumed by
  exhaustive switches, so the compiler will force every call site to handle `browser`.
- `app-shell/components/AppWorkspace.tsx`:
  - register `browserPanel: BrowserPanel` in the dockview `components` map (line ~1158).
  - add `case "browser"` to `createStoredPanelState` (~770) and `restoreWorkspacePanel`
    (~1027).
  - add an `addBrowserPanel` action + an entry in `WorkspaceGroupActions`/empty-state and
    the "new panel" menu so the user can open one.
- Persistence: a Browser Panel persists only its `url` (not the live webview). Decide
  whether it is a runtime-only panel (recreated empty) or restores its last URL —
  recommend **restore last URL** (matches Orca "retains state" e2e expectation).
- `projects.rs` + `session_layout` persistence: add the browser panel kind to the stored
  panel schema and the create/delete commands (mirror `workspace_terminal_panel_create`).

### Agent Thread feature additions (`features/agent-thread/`)

- `agentThreadStatusStore.ts`: add `useAgentThreadRuntimeStates()` returning the full
  `Map<threadId, AgentThreadRuntimeState>` (the existing `useAgentThreadRuntimeState`
  returns only the last entry, which the picker cannot use). Export a small selector for a
  single thread's status too.
- `agentThreadDraftStore.ts` (new, mirrors the status store): a `useSyncExternalStore`
  module keyed by `threadId` holding a pending injected draft string. `setThreadDraft(threadId,
text)` is called by the picker; `Composer` subscribes and prefills its textarea (review
  before send — not auto-submit). One draft per thread, cleared on consume.
- `Composer.tsx`: read the per-thread draft on mount/update and seed `prompt` state from it,
  then clear it. Keep the local-state composer; the draft is only the injection seam.

## 8. Element Selector — ported lifecycle

State machine (`useElementSelector.ts`, unchanged from Orca semantics):
`idle → armed → awaiting → confirming → idle/armed | error`.

1. Toggle on → `browser_set_selector_mode { enabled: true }` → Rust `webview.eval(ARM)`
   installs the in-page overlay (`window.__kiraSelect`), hover highlight + click trap.
2. User clicks → injected `finalize` builds `ElementCapturePayload`, posts it via
   `window.ipc.postMessage` → Rust `on_ipc` → `app.emit("browser://<id>", {kind:"capture"})`.
3. Frontend resolves to `confirming`, shrinks/hides the page webview, shows
   `ElementCaptureSheet`.
4. Copy copies the capture and re-arms for the next pick; Send to Agent Thread routes the
   capture (§8.1) and exits. Esc cancels (`browser_set_selector_mode {enabled:false}` →
   `webview.eval(TEARDOWN)`).

Screenshot: Orca uses CDP. Tauri replacement options — (a) drop the screenshot in v1
(payload still rich), or (b) `webview` capture if/when Tauri exposes it. Recommend **(a)**
for v1 and note the gap.

### 8.1 Capture output — picker + copy

When the `ElementCaptureSheet` is shown it offers exactly two outputs:

- **Copy**: `navigator.clipboard.writeText(formatGrabPayloadAsText(capture))`. Always
  available, even with no open threads.
- **Send to Agent Thread** (`AgentThreadPicker`):
  - **Source of "currently open threads"**: the active session's workspace panels of kind
    `agent_thread` (from the workspace runtime context — `panelId`, `title`, `threadId`),
    joined with `useAgentThreadRuntimeStates()` for live status. Show the thread title and a
    status dot (ready / sending / connecting / offline). Disable threads that are not
    connectable; sort most-recently-active first.
  - **On select**: `setThreadDraft(threadId, formatGrabPayloadAsText(capture))`, then
    activate that panel via `dockviewApi.getPanel(panelId).api.setActive()` so the user lands
    in the thread with the capture prefilled in the Composer, ready to review and send.
  - **Empty state**: no open Agent Threads → the picker shows "No open Agent Threads" and
    only Copy remains. (Optional later: a "New Agent Thread" affordance that creates one and
    routes the capture into it.)

Why prefill instead of auto-send: the capture is context the user augments with a question;
auto-submitting a bare capture would usually be wrong. This also keeps the Browser feature
from depending on each thread's live socket — it only writes a draft and activates the panel,
staying within the Agent Thread feature's public surface.

## 9. Risks & mitigations

| Risk                                                 | Mitigation                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `unstable` API churn across Tauri minors             | Pin exact `tauri` version; ADR; isolate all multi-webview calls in `browser.rs`                                                        |
| No child-webview hide/show                           | Off-screen reposition on panel hide/inactive; restore on activate                                                                      |
| White-on-load flash (#10011)                         | Gate reveal on first nav/`on_page_load`; keep off-screen until ready                                                                   |
| Bounds drift vs DOM (scroll/resize/split)            | `ResizeObserver` + dockview active/visibility callbacks; recompute on every change; window has no decorations so origin math is simple |
| React overlays under the native page                 | Shrink/offscreen the page webview while `ElementCaptureSheet`/find UI is shown                                                         |
| Multi-platform parity (WebView2/WKWebView/WebKitGTK) | Verify add_child + init script + `window.ipc.postMessage` on each target; Windows (WebView2) is primary dev target                     |
| Injected script vs hostile page redefining globals   | Keep Orca's "tear down any pre-existing `__kiraSelect` before arming" guard                                                            |

## 10. Phasing

1. **Spike** — prove `add_child` + `External(url)` + bounds-sync + `initialization_script`
   - `window.ipc.postMessage` round-trip on Windows. Gate the whole plan on this.
2. **Browser Panel MVP** — panel type, create/navigate/close, address bar, bounds-sync,
   offscreen-on-hide, persistence of URL. Satisfy the Orca-style "retains state on panel
   switch" behavior.
3. **Element Selector** — port guest script + state machine + `ElementCaptureSheet` with the
   **Copy** button.
4. **Send to Agent Thread** — `AgentThreadPicker` (open threads × live status), per-thread
   draft store, Composer prefill, panel activation; plus the `useAgentThreadRuntimeStates()`
   selector.
5. **Hardening** — multi-platform check, white-on-load gate, ADR + domain-language entries,
   e2e (adapt Orca's `browser-tab.spec.ts`).

## 11. Verification

- Rust: `bun run check:rust`, `bun run lint:rust`, unit tests for capture payload
  budgeting/redaction (port `browser-grab-types.test.ts`).
- Frontend: unit tests for `useElementSelector` state machine and capture formatting.
- Frontend: unit tests for the `AgentThreadPicker` — open-thread enumeration, status-driven
  disabling, empty state (Copy-only), and that selecting a thread writes the draft + targets
  the right `panelId`; plus a Composer test asserting it seeds from and clears the draft.
- E2E (Playwright/WebDriver per Kira's harness): open Browser Panel, navigate, switch
  panels (state retained), arm selector, click, assert capture payload — adapted from
  `tests/e2e/browser-tab.spec.ts`.
- Manual smoke on Windows (WebView2) before yielding.

## 12. Out of scope (v1)

Viewport/device emulation, screencast/remote pairing, cookie import, request interception,
mobile driver, find-in-page — all Orca features that depend on CDP and are not required for
"open websites + element selector".
