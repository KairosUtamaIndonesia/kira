# Implementation Plan: Commit Message Generator

## Overview

Add a **Generate** button (Sparkles icon) to `SourceControlInspector` that uses the Strands TypeScript SDK (in‑browser) to produce a structured conventional‑commit message from staged changes. A new Tauri command returns the combined staged diff + recent git log + provider credentials. The frontend feeds this into a Strands agent with `OpenAIModel`, parses the structured output via Zod, and fills the commit textarea.

## Architecture Decisions

- **SDK location:** `@strands-agents/sdk` in the Vite React bundle, not the agent-pi subprocess. Runs entirely in-browser.
- **Provider config:** The `source_control_staged_diff_log` Tauri command bundles provider API key + model configuration in its response, avoiding multiple IPC round trips.
- **Diff pre‑processing:** Done on the frontend (trim whitespace, collapse context runs, truncate large files). Keeps the Rust command pure and allows tuning the prompt budget without backend changes.
- **Model:** Reuses the default model from the org catalog (same `upstreamModelId` and `providerBaseUrl` the pi runtime uses). Configured via `OpenAIModel` with `api: 'chat'`.
- **Output schema:** Zod `z.object({ type: z.enum([...]), scope: z.string().optional(), title: z.string(), body: z.string().optional(), isBreaking: z.boolean() })` — maps to conventional commits format.
- **UI pattern:** Sparkles button between textarea and Commit button. Disabled during generation. Fills `commitMessage` state on success.

## Task List

### Phase 1: Validate Dependencies & Backend

#### Task 1: Install Strands SDK + Zod and verify Vite bundle

**Description:** Add `@strands-agents/sdk` and `zod` to the desktop app's package.json, then run `bun run build` to confirm the SDK compiles cleanly in the Vite bundle without Node.js polyfill issues.

**Acceptance criteria:**

- [ ] `@strands-agents/sdk` and `zod` are in `apps/desktop/package.json` dependencies
- [ ] `bun install` succeeds
- [ ] `bun run build` (Vite production build) succeeds
- [ ] Any missing bundler config (e.g., `vite.config.ts` resolve aliases) is fixed

**Verification:**

- [ ] Build succeeds: `bun run build`
- [ ] Manual check: import `Agent` from `@strands-agents/sdk` in a temporary file and confirm tree-shaking doesn't error

**Dependencies:** None

**Files likely touched:**

- `apps/desktop/package.json`
- `apps/desktop/bun.lock` (auto)

**Estimated scope:** Small (1–2 files)

---

#### Task 2: Add Rust Tauri command `source_control_staged_diff_log`

**Description:** Add a new Tauri command in `source_control.rs` that runs `git diff --cached` and `git log --oneline -10 --no-decorate`, then returns the results alongside the provider API key and default model config. The command reuses existing `run_git()`, `validate_project_folder()`, `stored_credential()`, and `get_model_catalog()`.

**Acceptance criteria:**

- [ ] New struct `StagedDiffLogInput` (reuses `SourceControlProjectInput` or defines identical fields)
- [ ] New struct `StagedDiffLogResult` with fields: `stagedDiff`, `recentLog`, `providerApiKey`, `providerBaseUrl`, `upstreamModelId`
- [ ] New function `source_control_staged_diff_log` annotated with `#[tauri::command]`
- [ ] Command validates `folder_path`, runs two git commands, reads keychain + model catalog
- [ ] Non‑git errors are mapped to `SourceControlError` variants
- [ ] Command is registered in `lib.rs`

**Verification:**

- [ ] `bun run check:rust` passes (cargo check)
- [ ] Manual: `curl`‑like test via Tauri invoke from browser devtools once frontend is wired

**Dependencies:** Task 1 (requires valid build; command can be written without it)

**Files likely touched:**

- `apps/desktop/src-tauri/src/source_control.rs`
- `apps/desktop/src-tauri/src/lib.rs`

**Estimated scope:** Small (2 files)

---

### Checkpoint: Backend

- [ ] `bun run check:rust` passes
- [ ] `bun run build` passes (full desktop build)

---

### Phase 2: Frontend Foundation

#### Task 3: Add TypeScript types and API client for staged diff log

**Description:** Add a `StagedDiffLogResult` type mirroring the Rust struct, and a `getStagedDiffLog` function in `sourceControlApi.ts` wrapping `invoke`. Also add a diff pre‑processing utility that trims trailing whitespace, collapses runs of >5 unchanged context lines to a `…` marker, and truncates any single-file diff >2KB to its first + last 30 lines.

**Acceptance criteria:**

- [ ] `StagedDiffLogResult` type exists in `source-control/types.ts`
- [ ] `getStagedDiffLog(input)` function exists in `sourceControlApi.ts`
- [ ] Diff pre‑processing utility exists as a pure function (`preprocessDiff(diff: string): string`)
- [ ] Pre‑processing handles: trailing whitespace removal, context line collapse, file‑wise truncation
- [ ] All new exports are properly typed

**Verification:**

- [ ] `bun run build` passes
- [ ] Manual: unit‑test the pre‑processing function via browser console

**Dependencies:** Task 2 (types must match Rust struct)

**Files likely touched:**

- `apps/desktop/src/features/source-control/types.ts`
- `apps/desktop/src/features/source-control/api/sourceControlApi.ts`
- `apps/desktop/src/features/source-control/api/diff-preprocess.ts` (new file)

**Estimated scope:** Small (3 files)

---

#### Task 4: Implement `useCommitMessageGenerator` hook

**Description:** Create a custom hook that orchestrates the generate flow: calls `getStagedDiffLog`, pre‑processes the diff, instantiates a Strands agent with `OpenAIModel` (configured from the provider data), runs `agent.invoke()` with a system prompt + assembled user prompt, parses the structured output via Zod, and returns the formatted commit message.

**Acceptance criteria:**

- [ ] Hook exposes `{ generate, isGenerating, error, result }`
- [ ] `generate()` returns a formatted commit string like `"feat(scope): title\n\nbody"`
- [ ] Agent system prompt specifies conventional commits but notes "follow the style of recent commits when they deviate"
- [ ] Agent always generates (no refusal for large diffs)
- [ ] `StrandsAgent` instance is created lazily and reused across `generate()` calls
- [ ] Provider API key, base URL, and model ID are passed from the staged diff log response
- [ ] Zod schema validates agent output; parse failures return a descriptive error
- [ ] `isGenerating` is `true` while the invoke is in flight
- [ ] Hook cleans up (aborts in‑flight generation) on unmount

**Verification:**

- [ ] `bun run build` passes
- [ ] Manual test: call `generate()` from browser console with a real repo

**Dependencies:** Task 3 (types + API client + pre‑processing)

**Files likely touched:**

- `apps/desktop/src/features/source-control/hooks/useCommitMessageGenerator.ts` (new file)

**Estimated scope:** Medium (1–2 files, new hook)

---

### Checkpoint: Core Logic

- [ ] `bun run build` passes
- [ ] Manual: invoke the full generate flow from browser console and inspect generated message

---

### Phase 3: UI Integration

#### Task 5: Add Generate button to SourceControlInspector

**Description:** Add a Sparkles icon button between the commit message textarea and the Commit button. Wire it to the `useCommitMessageGenerator` hook. Show a spinner during generation. On success, fill the textarea. On error, show the error via the existing `mutationError` pattern.

**Acceptance criteria:**

- [ ] Button with `<Sparkles />` icon (from `lucide-react`) is visible between textarea and Commit button
- [ ] Button is `disabled` when `isGenerating` or `isMutating` is true
- [ ] Button shows a spinning indicator while `isGenerating` is true (reuse `RefreshCw` with `animate-spin` or use a dedicated spinner)
- [ ] On generate success, `commitMessage` state is updated and textarea shows the message
- [ ] On generate error, `mutationError` is set and the error banner appears (existing UI)
- [ ] Button has `aria-label="Generate commit message"` and `type="button"`
- [ ] Button does not submit the commit form (separate from the Commit button logic)

**Verification:**

- [ ] `bun run build` passes
- [ ] Manual: open SourceControlInspector with staged changes, click Generate, verify message appears in textarea, verify loading state, verify error state (e.g., disconnect network)

**Dependencies:** Task 4 (hook), Task 1 (Strands SDK bundled)

**Files likely touched:**

- `apps/desktop/src/features/source-control/components/SourceControlInspector.tsx`

**Estimated scope:** Small (1 file)

---

### Phase 4: Polish & Cleanup

#### Task 6: Error handling edge cases

**Description:** Handle edge cases: no staged changes (disable Generate button), empty diff from command, agent returns unparseable output, Strands SDK fails to initialize, model catalog missing, no API key.

**Acceptance criteria:**

- [ ] Generate button is disabled when `stagedCount === 0` (no staged changes to generate from)
- [ ] If the staged diff is empty or agent returns empty string, commit message is NOT overwritten and user‑visible error shows "No staged changes to generate from"
- [ ] API key missing → error message directs user to sign in
- [ ] Unparseable agent output → error message includes raw agent text for debugging
- [ ] Strands SDK init failure → caught and surfaced as generation error

**Verification:**

- [ ] Manual: verify button disabled state with 0 staged files
- [ ] Manual: clear API key, verify error message
- [ ] Manual: provide garbage diff, verify error handling

**Dependencies:** Task 5

**Files likely touched:**

- `apps/desktop/src/features/source-control/hooks/useCommitMessageGenerator.ts`
- `apps/desktop/src/features/source-control/components/SourceControlInspector.tsx`

**Estimated scope:** Small (2 files)

---

### Checkpoint: Complete

- [ ] All tests pass (run `bun run build` — full build check)
- [ ] Generate button works end‑to‑end with real Git repository
- [ ] Loading states are visible and responsive
- [ ] Error states surface clear messages
- [ ] Button disabled when no staged changes
- [ ] Review with human before merging

## Risks and Mitigations

| Risk                                                                  | Impact                                     | Mitigation                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenAIModel` does not expose `baseUrl`/`apiKey` in constructor       | High — cannot route through existing proxy | Fall back to Vercel AI SDK adapter or vendor‑specific model provider that supports custom base URL. Investigate in Task 1 (install + test).  |
| `@strands-agents/sdk` fails to bundle with Vite (Node polyfills)      | High — Strands won't run in browser        | Investigate in Task 1. Mitigations: configure Vite `resolve.alias` for Node built‑ins, or use dynamic import with conditional check.         |
| Staged diff is very large (>8k tokens)                                | Medium — prompt exceeds context window     | Pre‑processing truncates per‑file. Add a token‑budget log line before invoke. If still too large, summarise file list instead of full diff.  |
| `stored_credential()` returns `None` (user not signed in)             | Medium — cannot call provider              | Generate button disabled; error message directs user to sign in via settings.                                                                |
| Model catalog `get_model_catalog()` returns error (no cached catalog) | Medium — no model to configure             | The pi runtime must have started successfully for the app to be useful. If catalog is missing, highlight that the org catalog needs to sync. |
| Strands SDK adds >200KB to bundle                                     | Low — acceptable for a desktop app         | Monitor build output. If excessive, code‑split the generate hook behind a lazy import.                                                       |

## Open Questions

1. **`OpenAIModel` constructor API** — The blog post shows `new OpenAIModel({ api: 'chat', modelId: 'gpt-4o' })`. Does it accept `baseUrl` and `apiKey`? Resolve in Task 1 by inspecting the npm package source or running a quick test import.
2. **Env vs IPC for provider config** — The keychain read (`stored_credential()`) is synchronous. Bundling it in the staged diff command response is the simplest approach, but do we want a dedicated `desktop_provider_credential_get` command instead for reuse? Decision: bundle for now; extract later if needed.
3. **Model selection** — Currently reuses the default model from the org catalog. For commit generation, a cheaper/faster model may be preferable (e.g., `gpt-4o-mini` if available). Decision: start with default model; add model override in config later.
