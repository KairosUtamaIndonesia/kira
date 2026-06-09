# Skills Inspector Plan

## Objective

Add a read-only **Skills** view to Kira's Inspector that shows the Agent Skills available to the user, grouped by provenance:

- **Bundled** — skills compiled into `@kira/agent-runtime` and always loaded by Kira's Flue coding agent.
- **Project** — skills discovered from the active Project's `.agents/skills/`, loaded by Kira's agent for that Project.
- **Global** — skills installed at the machine-level skills root. Inventory only; **not** loaded by Kira's Flue agent.

Scope is strictly _visibility_ of installed skills. Installing/removing skills and the skills.sh catalog/API are explicitly out of scope for this plan (the skills.sh API requires Vercel OIDC, which Kira cannot mint; see prior investigation).

## Context Summary

Prepared after reviewing Kira's inspector pattern, the Rust command layout, the agent-runtime, and Flue's skill resolution in `.flue-source`.

### How skills resolve today

Flue (`packages/runtime/src/context.ts`) resolves a session's skill catalog as `mergeSkillCatalog(definitionSkills, discoverLocalSkills(env, cwd))`:

- `definitionSkills` = skills passed to an agent's `skills: [...]` via `import … with { type: 'skill' }`. These are **bundled** into the application build. This is the only skill set Rust cannot enumerate from disk (compiled/tree-shaken into JS).
- `discoverLocalSkills` scans **exactly one** path: `skillsDirIn(cwd)` = `<cwd>/.agents/skills/`. In Kira, `createKiraLocalSandbox(projectPath)` sets `cwd = projectPath`, so this is the **Project** scope. Flue parses only `SKILL.md` frontmatter (`name`, `description`) — it does **not** read `skills-lock.json`, so it yields no `source`/`hash`.
- Flue has **no global concept**. It never scans the home dir or walks parent directories.
- Name collision between a bundled and a discovered skill **throws** at init: `Skill name "X" appears in both agent definition and workspace discovery.` This is a hard runtime failure, not a silent override.

Consequences for this feature:

- Flue is the authority for the **bundled** set and the **conflict rule** only.
- Rust must own the filesystem inventory for Project and Global (Flue's view is lossy and runtime/session-bound).
- Kira's coding agent currently bundles **zero** skills (`apps/desktop/agent-runtime/src/agents/coding.ts` has no `skills:` array).

### On-disk skill layout (confirmed in repo)

- Project lock: `<project>/skills-lock.json` maps `name -> { source, sourceType, skillPath, computedHash }`.
- Materialized skill: `<root>/.agents/skills/<name>/SKILL.md` with frontmatter `name` + `description` (and supporting files alongside).

### Kira patterns to mirror

- Inspector views: `apps/desktop/src/features/app-shell/components/AppInspector.tsx` — `inspectorViewActions` icon rail + `inspectorContent(...)` switch ending in `assertNever`.
- Feature module shape: `apps/desktop/src/features/source-control/` — `types.ts`, `api/<feature>Api.ts` (`invoke<T>("command", { input })`), `hooks/use…`, `components/<Feature>Inspector.tsx`, reusable `EmptyState`.
- Rust feature module: `apps/desktop/src-tauri/src/source_control.rs` — `serde(rename_all = "camelCase")` structs, `thiserror` error enum, `#[tauri::command]` thin wrappers; registered in `lib.rs` `invoke_handler!`.
- Runtime `/app` routes: `apps/desktop/agent-runtime/src/kira/app-routes.ts`, mounted via `app.route("/app", appRoutes)` behind `requireRuntimeToken`.
- Rust → runtime connection: `agent_runtime.rs` holds `RuntimeConnection { base_url, token }` in `AgentRuntimeRegistry` (managed state). Bundled-skill queries reuse this.

### Project rules that constrain this work

- Keep feature code near the feature; no shared dumping grounds.
- Explicit typed boundaries, fail-fast, no hidden fallbacks (no `?? []` to mask scan failure).
- Rust app code denies `unwrap`/`expect`/`panic`/`todo`/`unimplemented`/`dbg!`/unsafe; `clippy::pedantic` warn.
- Frontend: no raw `console`, no `any`, no non-null assertions; use design tokens, not hardcoded colors.
- Runtime: typed boundaries, validate untrusted JSON, `flue:*`/`app:*` prefixes, no raw `console`.

## Domain Language additions

Propose adding to `docs/domain-language.md` (pending approval, per canon — these are real new domain terms):

- **Skill**: A reusable Agent Skill (`SKILL.md` + supporting files) that guides agent behavior. _Avoid_: Plugin, extension.
- **Skill Scope**: The provenance of an installed Skill — `Bundled`, `Project`, or `Global`. _Avoid_: Skill location.
- **Bundled Skill**: A Skill compiled into the agent-runtime and always loaded by Kira's agent.
- **Skill Conflict**: A Bundled and Project Skill sharing a declared name, which fails Flue session initialization.

## Architecture & Ownership

Single Tauri command returns the entire composed view; the frontend never talks to the runtime directly (AGENTS boundary).

```
React SkillsInspector
  -> invoke("skills_list", { projectPath })
       Rust skills.rs:
         - scan Project root  (<project>/.agents/skills + skills-lock.json)
         - scan Global root   (resolved skills root; see Open Questions)
         - fetch Bundled set  (GET runtime /app/skills via RuntimeConnection)
         - compute conflicts  (bundled.name == project.name)
       -> SkillsListResult { bundled, project, global, conflicts, bundledSource }
```

Ownership split:

- **agent-runtime** owns the bundled list (single source of truth in TS), exposed at `GET /app/skills`.
- **Rust `skills.rs`** owns filesystem inventory (Project + Global), lock/frontmatter parsing, the runtime fetch, conflict computation, and composition.
- **React `skills` feature** owns rendering, grouping, filtering, and opening a `SKILL.md` panel.

Rationale: Flue cannot give us Global at all and gives only `name`/`description` for Project. Rust already owns local-filesystem features and the runtime connection. Keeping bundled in the runtime avoids duplicating the import list Rust can't see.

## Data Model

### Rust (`apps/desktop/src-tauri/src/skills.rs`)

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
enum SkillScope { Bundled, Project, Global }

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
struct InstalledSkill {
    name: String,
    description: String,
    scope: SkillScope,
    source: Option<String>,        // from skills-lock.json; None for bundled
    source_type: Option<String>,   // "github" | "well-known"; None for bundled
    skill_path: Option<String>,    // absolute path to SKILL.md; None for bundled
    hash: Option<String>,          // computedHash from lock; None when absent
    loaded_by_agent: bool,         // true for Bundled + Project, false for Global
    conflict: bool,                // true when name collides Bundled<->Project
}

#[derive(Serialize)] #[serde(rename_all = "camelCase", tag = "kind")]
enum BundledSource { Ready, RuntimeUnavailable { reason: String } }

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
struct SkillsListResult {
    bundled: Vec<InstalledSkill>,
    project: Vec<InstalledSkill>,   // empty when no project / no .agents/skills
    global: Vec<InstalledSkill>,
    conflicts: Vec<String>,         // colliding skill names
    bundled_source: BundledSource,  // degraded state if runtime is down
}

#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
struct SkillsListInput { project_path: Option<String> }

#[derive(Debug, Error)]
enum SkillsError { /* IoFailure, FrontmatterParse{path}, LockParse{path}, GlobalRootUnavailable */ }
```

### TS (`apps/desktop/src/features/skills/types.ts`)

```ts
type SkillScope = "bundled" | "project" | "global";

type InstalledSkill = {
  name: string;
  description: string;
  scope: SkillScope;
  source: string | null;
  sourceType: "github" | "well-known" | null;
  skillPath: string | null;
  hash: string | null;
  loadedByAgent: boolean;
  conflict: boolean;
};

type BundledSource = { kind: "ready" } | { kind: "runtimeUnavailable"; reason: string };

type SkillsListResult = {
  bundled: InstalledSkill[];
  project: InstalledSkill[];
  global: InstalledSkill[];
  conflicts: string[];
  bundledSource: BundledSource;
};

type SkillsListInput = { projectPath: string | null };
```

## Backend (Rust) Plan

New module `apps/desktop/src-tauri/src/skills.rs`, declared in `lib.rs` and registered in `invoke_handler!`.

1. **Frontmatter parse** — read `SKILL.md`, extract `---` YAML block, pull `name` + `description`. Reuse a minimal parser (the `^---\r?\n…\r?\n---` shape already used in `agent-runtime/src/kira/local-sandbox.ts`). Fail fast with `SkillsError::FrontmatterParse { path }` on a malformed/empty block — no silent skip.
2. **Lock parse** — read `<root>/skills-lock.json` (`{ version, skills: { name: { source, sourceType, skillPath, computedHash } } }`) into a map. Missing lock is valid (returns empty map); malformed lock is `SkillsError::LockParse`.
3. **Scan one root** — `scan_skills_root(root, scope) -> Vec<InstalledSkill>`: enumerate `<root>/.agents/skills/<name>/SKILL.md` dirs, parse each frontmatter, enrich from the lock map by frontmatter `name`, set `scope`, `loaded_by_agent` (true for Project, false for Global). Directory absent → empty vec.
4. **Project root** = `input.project_path` when present, else no project section.
5. **Global root** = resolved machine skills root (see Open Questions). Resolution lives in one function `global_skills_root() -> Option<PathBuf>`; `None` ⇒ empty global section, never a guessed path.
6. **Bundled fetch** — `fetch_bundled(connection) -> (Vec<InstalledSkill>, BundledSource)`: GET `{base_url}/app/skills` with `Authorization: Bearer {token}` (reuse `RuntimeConnection`). Map response to `InstalledSkill { scope: Bundled, loaded_by_agent: true, source*: None }`. Runtime `NotStarted`/`Failed`/HTTP error ⇒ empty bundled + `BundledSource::RuntimeUnavailable { reason }`. Bundled degradation must **not** fail the whole command — Project/Global still return.
7. **Conflicts** — `conflicts` = bundled names ∩ project names. Set `conflict: true` on the matching entries in both `bundled` and `project`.
8. **Command** — `#[tauri::command] async fn skills_list(input, registry: State<AgentRuntimeRegistry>) -> Result<SkillsListResult, SkillsError>`. Keep the command thin; push logic into helpers.

Expose the registry connection: add a small accessor on `AgentRuntimeRegistry` returning `Option<RuntimeConnection>` (clone) so `skills.rs` can reach the runtime without duplicating supervision state.

## Runtime (agent-runtime) Plan

Single source of truth for bundled skills, consumed by both the agent config and the new endpoint.

1. New `apps/desktop/agent-runtime/src/kira/bundled-skills.ts`:
   ```ts
   // import review from "../../skills/review/SKILL.md" with { type: "skill" };
   export const bundledSkills = [
     /* review, … */
   ] as const; // empty today
   ```
2. `agents/coding.ts` consumes it: `skills: [...bundledSkills]` in the agent config (no behavior change while empty).
3. `app-routes.ts` adds `appRoutes.get("/skills", …)` (already behind `requireRuntimeToken`) returning `{ skills: { name, description }[] }` derived from `bundledSkills`. Validate/shape output explicitly; keep `app:*`/typed boundary discipline.

This keeps the bundled list authored once in TS, served to Rust, and merged into the agent — no duplication and no Rust visibility into JS imports.

## Frontend Plan

New feature `apps/desktop/src/features/skills/`:

- `types.ts` — types above.
- `api/skillsApi.ts` — `getSkillsList(input: SkillsListInput) => invoke<SkillsListResult>("skills_list", { input })`.
- `hooks/useSkillsList.ts` — mirror `useSourceControlStatus`: `{ status: "idle" | "loading" | "ready" | "error" }` keyed on `projectPath`, with `refresh`.
- `components/SkillsInspector.tsx` — props `{ folderPath: string | undefined; onOpenSkill: (skill: InstalledSkill) => void }`.

`SkillsInspector` layout (mirrors `SourceControlInspector` header + grouped sections):

- Header: `Boxes` icon + active project name + refresh button.
- Filter input (`name` + `description`, case-insensitive), reusing the trimmed-lowercase pattern.
- Three collapsible sections with counts and captions:
  - **Bundled · N** — caption "ships with Kira". `BundledSource.runtimeUnavailable` ⇒ section shows a muted "Runtime unavailable — bundled skills can't be listed." note (does not block other sections). Empty ready ⇒ "Kira's agent bundles no skills yet."
  - **Project · N** — caption "discovered for agent". No `folderPath` ⇒ EmptyState "Open a Project to see its skills." Empty with project ⇒ "No skills installed in this Project."
  - **Global · N** — caption "not loaded by Kira's agent". Empty ⇒ "No global skills installed."
- Row anatomy: bold `name`; muted `description` (1–2 lines, truncated); provenance line `⌂ {sourceType} · {source}` (omitted for bundled, which shows `◆ runtime · @kira/agent-runtime`).
- Badges (only when notable): `⚠ conflict` (destructive token) on Bundled/Project name collisions; nothing on the common case.
- Whole row is the click target → `onOpenSkill(skill)`.
- Loading/error reuse a local `EmptyState` (message + optional `role="alert"`).

Skill detail opens the skill's `SKILL.md` read-only in a Workspace Panel by reusing the existing file-editor panel flow (`openFileEditorPanel` / `workspace_file_editor_panel_open`) with `skill.skillPath`. Bundled skills have no on-disk `skillPath` for the user → detail action disabled for bundled rows (or omitted) in this phase.

## Inspector Wiring

In `AppInspector.tsx`:

- Add `"skills"` to the `InspectorView` union.
- Add `{ view: "skills", label: "Skills", icon: Boxes }` to `inspectorViewActions` (import `Boxes` from `lucide-react`).
- Add a `skills` branch in `inspectorContent(...)` rendering `<SkillsInspector folderPath={activeWorkspace.status === "active" ? activeWorkspace.project.folderPath : undefined} onOpenSkill={…} />`, keeping the terminal `assertNever(activeView)`.
- Thread an `onOpenSkill` handler down from `AppShell` that opens the `SKILL.md` editor panel, mirroring `onExplorerFileOpen`.

## Conflict Semantics (must surface)

A Bundled and Project skill sharing a `name` makes Flue **fail session init** for that Project. The UI must show `⚠ conflict` on both entries and list them in `conflicts`. Consider a Status Bar warning in a follow-up, since it breaks the agent for that Project — out of scope for the first slice but noted.

Global↔Project same-name is **not** a conflict (Global isn't loaded by Kira's agent); no badge.

## Open Questions / Prerequisites

1. **Global skills root path** — Flue defines no global location; this is a skills.sh-CLI / agentskills convention. Leading candidate: `~/.agents/skills/` (mirrors the workspace `<cwd>/.agents/skills/`). **Prerequisite spike:** confirm where `npx skills` installs global skills before writing `global_skills_root()`. If unconfirmable, ship Global as always-empty with an explanatory note rather than guessing a path into product code (canon: no hidden fallbacks).
2. **Bundled detail view** — bundled skills have no user-facing on-disk path. Decision for this slice: disable the row click for bundled. Revisit if we later extract packaged skill files to a readable location.
3. **Refresh model** — manual refresh button + reload on `projectPath` change for the first slice; no filesystem watcher.

## Phasing

1. **Runtime bundled endpoint** — `bundled-skills.ts` (empty), `coding.ts` wiring, `GET /app/skills`. Verify with an authenticated curl against the running sidecar.
2. **Rust scan + command** — `skills.rs` (frontmatter/lock parse, Project + Global scan, conflict calc), registry connection accessor, runtime fetch, register `skills_list`. Verify against this repo (`.agents/skills/` has `tauri-v2`, `gitbutler`) and `skills-lock.json`.
3. **Frontend feature + inspector wiring** — types, api, hook, `SkillsInspector`, inspector view, `AppShell` open-skill handler.
4. **Conflict + degraded states** — render `⚠ conflict`, `runtimeUnavailable`, and all empty states.
5. **Verification & cleanup** — see below; domain-language update (with approval); changelog/doc if the repo tracks one.

## Verification

- **Rust** (`bun run test:rust` + targeted unit tests in `skills.rs`):
  - Scan a fixture root with two skills + a `skills-lock.json` → enriched `source`/`hash`.
  - Skill present on disk but absent from lock → `source: None`, still listed.
  - Malformed `SKILL.md` frontmatter → `FrontmatterParse` error (fail-fast, not skipped).
  - Conflict: same name in bundled + project fixtures → both flagged, name in `conflicts`.
  - Runtime down → `bundled` empty, `bundledSource = runtimeUnavailable`, Project/Global still populated.
  - `global_skills_root() == None` → empty global, no error.
- **Runtime**: `GET /app/skills` returns the bundled names; 401 without token (reuses `requireRuntimeToken`).
- **Manual**: open the Skills view with this repo as the Project → Project shows `tauri-v2` + `gitbutler`; toggle a fabricated bundled skill matching a project name → conflict badge appears; stop the sidecar → bundled section degrades while Project/Global persist.
- Run `bun run check` / `bun run lint:all` / `bun run check:rust` across changed files before finishing.
