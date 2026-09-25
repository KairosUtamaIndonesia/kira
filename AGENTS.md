## How to work

Understand the constraint, then choose the smallest change that makes the correct behavior clear. We want simple systems, not machinery that looks impressive.

### GitButler change control

This repository uses GitButler (`but`) for version-control inspection and write operations. The workspace may be shared by several agents, so every session must preserve existing work, isolate its own changes, and leave a recoverable checkpoint.

**Start every session**

1. Run `but status` and `but diff` before editing. If GitButler reports that setup is required, stop and ask the owner to run `but setup` once; setup changes repository registration, the workspace branch, and target configuration.
2. Treat pre-existing changes and applied branches as owned by another session unless the user explicitly assigns them to you. Do not edit, commit, move, amend, squash, discard, or push them.
3. Use a unique branch such as `agent/<task>-<session-id>`. At the first checkpoint, run `but diff`, then commit only this session's files or hunks with `but commit -b <branch> -m "..." <change-id>...`.

**Work without collisions**

- Recheck `but status` before each logical edit and before committing or handing off. Compare the new state with your starting snapshot: continue through unrelated paths and hunks, and isolate your own changes by path or hunk when committing. Pause only the affected edit when another session has changed the same lines or created a real conflict; preserve the state with `but oplog snapshot -m "..."` when available, then report the exact paths and branches.
- GitButler branches share one filesystem, dependency tree, generated-output area, and runtime state. Use separate worktrees or serialize only when work actually competes for those shared resources—for example, overlapping edits, incompatible checkouts, or shared runtime state. Independent changes can proceed in parallel. Stack branches explicitly when one task depends on another.
- Checkpoint meaningful milestones and before any handoff. Keep commits focused and include the branch and commit IDs in the handoff so another agent can resume without guessing.

**Finish and recover**

- Before finishing, inspect `but status` and `but diff`; leave no session-owned change only in the uncommitted workspace. Do not push or open a pull request unless asked.
- Undo only your own last GitButler operation with `but undo`. For conflicts, use `but resolve`, check `but resolve status`, and finish or cancel the resolution explicitly.
- For uncertain or broader recovery, inspect `but oplog list` first. Ask before `but oplog restore`, because restoring workspace state can replace another agent's work. Never use a reset, clean, discard, or history rewrite as a collision shortcut.

### Action-oriented responses

Shape responses so the reader can act without holding context in working memory.

1. **Lead with the action or result.** Start with the command, path, snippet, decision, or concrete status. Do not begin with a preamble.
2. **Number multi-step work.** Use the fewest bounded steps that complete the task. Keep each step to one clear action.
3. **Keep state visible.** For ongoing work, state the current step, what changed, and the next step. Use the task tool for multi-step work instead of repeating a full plan in prose.
4. **Show completed work concretely.** Name the files changed, behavior that now works, and checks that passed.
5. **End with one next action when work remains.** Make it specific and doable in under two minutes. Do not add a next action when the task is complete.
6. **Suppress tangents.** Finish the requested work first. Mention unrelated follow-up work separately and only when it affects the current task.
7. **Use concrete estimates when useful.** Prefer bounded estimates such as “15 minutes if tests already cover this” over vague phrases such as “a bit of work.”
8. **Keep visible lists to five items or fewer.** Group or rank longer lists. Do not omit details when completeness matters.
9. **Use a matter-of-fact tone.** State failures as `location → expected result → actual result → cause → fix`. Avoid alarmist language and filler.
10. **Skip preambles and pleasantries.** Do not start with “Great question,” “Let me,” or “Sure.” Do not end with a recap or “let me know.”

#### Exceptions

- Explain fully when the user asks for an explanation or walkthrough.
- Confirm before destructive actions.
- Ask one concise question when the request is genuinely ambiguous.
- System, developer, safety, and harness instructions take precedence over these formatting rules.
- If the user says “stop ADHD mode” or “normal mode,” use the default response style instead.

### Say it plainly

- Lead with the bottom line: the first sentence answers the question or names the recommendation. Reasoning follows, for whoever wants it.
- Recommend, don't menu. Name the option you would ship and why; raise an alternative only when it changes the decision.
- A long answer usually means a decision hasn't been made yet. Decide, then cut the answer to the decision and its consequences.
- Ask one question per turn — the single thing blocking progress — and park the rest.
- Use the words already in the conversation. Define a term you introduce at first use; reach for a plain word whenever one does the job.

### Think before coding

- State assumptions that affect the result. If multiple interpretations would lead to different implementations, lay them out rather than silently choosing one.
- Name uncertainty. When an ambiguity changes scope, behavior, or safety, ask before proceeding; don't code around something you haven't understood.
- Surface tradeoffs and point out simpler approaches. Push back when the requested approach adds complexity without solving a real constraint.
- Understand the actual flow before choosing a shortcut. For bugs, inspect callers and sibling paths, then fix the root cause at the shared boundary rather than patching only the reported symptom.

### Simplicity first

After understanding the problem, stop at the first option that meets the requirements:

1. **Does this need to exist?** Skip speculative work; explain what concrete need would justify it.
2. **Does the codebase already solve it?** Look for existing helpers, types, components, and patterns before writing replacements.
3. **Does the standard library or platform cover it?** Prefer built-in behavior over custom machinery: CSS over JavaScript layout logic, native capabilities over a new dependency, while preserving the app's design and accessibility conventions.
4. **Does an installed dependency solve it?** Use it before adding another. Don't add a dependency for something a few clear lines can do.
5. **Only then, write custom code.** Keep it as small and direct as correctness and readability allow.

- No speculative features, configurability, or scaffolding for later. Extract shared behavior for real duplication, not hypothetical future callers. Avoid single-use factories and interfaces that add no meaningful boundary.
- Prefer removing unnecessary machinery over adding another layer. Keep the diff and number of files small, but don't compress code into clever one-liners or bypass established ownership boundaries.
- Handle real failure modes, not impossible scenarios already ruled out by the boundary. Don't preserve backward compatibility unless requested.
- Never simplify away trust-boundary validation, protection against data loss, security, accessibility, or explicitly requested behavior. Among equally simple options, choose the one that handles real edge cases correctly.
- When a deliberate simplification has a known limit, document that limit and the condition for revisiting it near the code. Obvious code needs no comment defending its simplicity.
- Review the result for unnecessary machinery. If a substantially smaller implementation would be equally clear and correct, simplify it before calling the work done.

### Surgical changes

- Read enough surrounding code to understand the change; read files fully for audits and broad rewrites. Match existing style and conventions.
- Don't improve adjacent code, comments, or formatting just because you're there. Refactor only where the requested change needs it.
- Remove imports, variables, functions, and other code that your changes make unused. Flag unrelated dead code rather than deleting it.
- Every changed line should serve the requested outcome. Ask before removing intentional functionality outside the agreed scope.

### Goal-driven execution

- Turn the request into observable success criteria before implementing. “Make it work” is not a verification plan.
- For a bug fix, reproduce the failure with a focused regression test, then make it pass. For validation, cover invalid inputs and the expected failures. For a refactor, verify that behavior is preserved before and after.
- For multi-step work, give a short plan pairing each step with how you'll verify it. Keep routine, trivial edits lightweight.
- Run relevant checks, fix failures caused by your changes, and repeat until the success criteria are met or you're genuinely blocked. Don't stop at the first implementation when verification is part of the task.
- Report what you checked and what remains unverified. Scale verification to the risk; a typo fix does not need a full test run.

### Working boundaries

Don't overwrite unrelated work or use live sessions, credentials, or workspace state as disposable test fixtures. Ask before destructive actions or restarting processes you didn't start. If a task conflicts with repository guidance, call out the conflict and get confirmation before overriding it.

## Documentation

`docs/` contains guides for people **using** Foundry. `docs/internal/` contains conventions, architectural decisions, and procedures for people and agents **building** it.

Keep one home for each subject and link to it elsewhere. Update the section that became inaccurate rather than appending a work log. Document constraints and reasoning the code cannot explain; don't maintain a prose copy of the implementation.

Add changelog entries for user-facing, release-relevant changes under `## [Unreleased]` in `CHANGELOG.md`. Internal refactors, tests, and documentation-only changes don't need entries unless they affect released behavior or release operations.

## Code conventions

The desktop backend organises `apps/desktop/src/main/` by kind of code — `ipc/`, `db/`, `pi/` — with imports pointing one way, and the window splits what the chat _does_ (assistant-ui) from what it _looks like_ (Astryx). `docs/internal/desktop-conventions.md` is the rule. Read it before adding a file or folder there.

## Frontend debugging

When working on the Electron renderer, frontend behavior, or UI bugs, read
[`docs/internal/frontend-debugging.md`](docs/internal/frontend-debugging.md) before testing the
app. It is the required workflow for driving the dev app with `agent-browser` over CDP on port
1987, including what to tell the user when `agent-browser` is not installed.

## Agent skills

`.agents/skills/` holds the skills for this repo. Read the one that matches the work
before starting it — they are the procedures, not background reading. `ask-matt` is the
router when the right skill is not obvious: it maps a situation onto the flow
(idea → spec → tickets → implement) and the standalone skills around it.

| When the work is                                 | Read                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Building a spec or ticket                        | `.agents/skills/implement/SKILL.md` — `/tdd` at the seams, then `/code-review`, then commit                                                         |
| Writing or reviewing tests                       | Load `.agents/skills/writing-good-tests/SKILL.md` before writing or changing tests — table-driven cases, real dependencies, condition-based waiting |
| Using GitButler for version control              | `.agents/skills/gitbutler/SKILL.md` — status, diffs, branches, commits, and other version-control operations                                       |
| Building a feature test-first                    | `.agents/skills/tdd/SKILL.md`                                                                                                                       |
| Reviewing a branch or diff                       | `.agents/skills/code-review/SKILL.md`                                                                                                               |
| Sharpening an idea before building it            | `.agents/skills/grill-with-docs/SKILL.md`                                                                                                           |
| Working out how big the work is                  | `.agents/skills/wayfinder/SKILL.md`                                                                                                                 |
| Designing a module's shape                       | `.agents/skills/codebase-design/SKILL.md`                                                                                                           |
| Settling project words or recording a decision   | `.agents/skills/domain-modeling/SKILL.md`                                                                                                           |
| Something broken, or a slow regression           | `.agents/skills/diagnosing-bugs/SKILL.md`                                                                                                           |
| Checking the codebase's health                   | `.agents/skills/improve-codebase-architecture/SKILL.md`                                                                                             |
| Writing a skill, or editing this file            | `.agents/skills/writing-for-agents/SKILL.md`                                                                                                        |
| Research to be delegated and cited               | `.agents/skills/research/SKILL.md`                                                                                                                  |
| Steps only a human can take                      | `.agents/skills/wizard/SKILL.md`                                                                                                                    |
| Chat UI, its runtime, primitives, tools, threads | `.agents/skills/assistant-ui/SKILL.md`, which routes to its siblings                                                                                |

### Issue tracker

Issues live as GitHub issues, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.
