# Commit Message Generator

## Problem Statement

How might we help Kira desktop users write better Git commit messages by generating structured, conventional-commit-style messages from their staged changes — using the Strands TypeScript SDK directly in the browser?

## Recommended Direction

Add a **Generate** button (Sparkles icon) next to the commit message textarea in `SourceControlInspector`. Clicking it calls a new Tauri command that returns a combined staged diff + recent commit log, pre‑processed for token efficiency. The frontend passes this to a Strands agent configured with an `OpenAIModel` pointed at the same provider proxy the pi runtime uses. The agent returns a structured commit message via Zod schema (`{ type, scope, title, body, isBreaking }`), which fills the textarea.

The agent is instructed to prefer conventional commits (`feat:`, `fix:`, `chore:`, etc.) but to match the style of the previous commits when they deviate. It always generates — no refusal on "diff too large" — but the pre‑processing keeps the input lean.

The Strands SDK is bundled in the Vite React app (`@strands-agents/sdk`), not in the agent-pi subprocess. This keeps the feature self-contained in the frontend and avoids crossing process boundaries for a one-shot generation.

## Key Assumptions to Validate

- [ ] `OpenAIModel` from `@strands-agents/sdk/models/openai` accepts `baseUrl` and `apiKey` options (or a custom client). The blog post shows only `{ api, modelId }`. If not, we fall back to the Vercel AI SDK adapter or bundle a thin wrapper.
- [ ] `@strands-agents/sdk` bundles cleanly with Vite in the browser without Node.js polyfills. The SDK claims browser support; verify with a `npm install && bun run build`.
- [ ] Combined staged diff (`git diff --cached`) for typical repos fits within a 4k-8k token budget after cleaning. Worst case: diff larger than context window → we truncate per-file and note it in the prompt.
- [ ] Users have `KIRA_AGENT_PROVIDER_API_KEY` and `KIRA_AGENT_MODEL_CATALOG` available in the Tauri webview's `process.env`. Tauri v2 exposes env at build‑time; we may need a Tauri command to read them at runtime.

## MVP Scope

### In

- New Tauri command: `source_control_staged_diff_log` — runs `git diff --cached` + `git log --oneline -10 --no-decorate`, returns combined text.
- Pre‑processing: trim trailing whitespace per line, collapse runs of >5 unchanged context lines, truncate any single file diff >2KB to its first + last 30 lines with a `…` marker.
- `npm install @strands-agents/sdk zod` in `apps/desktop/`
- New hook: `useCommitMessageGenerator(folderPath)` — exposes `{ generate, isGenerating, error }`.
  - `generate()` → invokes Tauri command → feeds into Strands agent with `OpenAIModel` → parses structured output → returns `{ type, scope, title, body }`.
- Sparkles button (`<Sparkles />` from `lucide-react`) in `SourceControlInspector` between the textarea and the Commit button.
  - Disabled while `isGenerating` or `isMutating`.
  - Shows spinner during generation.
  - On success, fills `commitMessage` state.
  - On error, shows inline error via existing `mutationError` pattern.
- Agent system prompt specifies conventional commits but notes "follow the style of recent commits". Agent always generates.

### Out

- Streaming into the textarea character-by-character (future).
- Edit/regenerate cycle with follow-up prompts (future).
- Custom configuration UI for commit format preferences (future).
- Multi-repo or monorepo scope detection beyond file paths (future).
- Support for non-OpenAI-compatible providers behind Strands (future).

## Not Doing (and Why)

- **No backend generation (agent-pi subprocess)** — the Strands SDK runs in the browser, so we avoid the IPC + process overhead of the pi agent runtime. The only new backend surface is the combined diff command, which is a thin `run_git` wrapper.
- **No streaming** — the `invoke` call is fast enough (<2s for typical diffs with small models). Streaming adds UI complexity without proportional UX value at MVP.
- **No refusal/review pattern** — always generate, even for large diffs. The user remains in control; they can edit or discard.
- **No diff preview in the generate flow** — the user already sees staged files in the panel. Adding a diff preview to the generation flow is scope creep. The agent sees the diff; the user sees the result.
- **No grounding in issue tracker or branch name** — could improve quality, but adds dependencies (Tauri command for branch, API calls for issues). Cut for MVP.

## Open Questions

1. Does `OpenAIModel` expose `baseUrl` and `apiKey` in the TS SDK constructor? If not, we need a thin wrapper or a different model provider path.
2. Can we read `KIRA_AGENT_PROVIDER_API_KEY` and model config from the Tauri webview, or do we need a dedicated Tauri command to bridge them?
3. What model ID should the Strands agent use? The pi runtime configures a specific `upstreamModelId` — should we reuse it, or pick a cheaper/faster model for commit generation (e.g., `gpt-4o-mini` if available)?
4. Should the combined diff command be cached (e.g., debounced) so rapid re-clicks don't re-run git?
