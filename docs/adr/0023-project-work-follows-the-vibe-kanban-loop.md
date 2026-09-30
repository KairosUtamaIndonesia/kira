# Project Work follows the Vibe Kanban execution loop

Date: 2026-09-25

Superseded by ADR 0024: the board stays; the execution workspace, review and delivery loop is removed.

## Context

The earlier Project Work scope expanded toward Linear's full planning model: organizations, teams, initiatives, milestones, cycles, updates, documents, permissions, and integrations. That scope is larger than the product Kira needs now.

Vibe Kanban's current product flow is narrower and more direct. An issue is planned on a kanban board. A workspace is created for that issue, an agent starts in a repository checkout, and the person inspects the result through logs, terminal, diff, and browser preview. Review comments are sent back to the agent, the loop repeats, and the workspace is merged locally or through a pull request.

Vibe Kanban's repository is currently marked as sunsetting. This decision adopts its product shape and flow, not its code or future roadmap.

## Decision

**Kira Project Work follows the Vibe Kanban loop.** The core product is a kanban issue tracker connected directly to agent execution and code review.

The core model is:

```text
Organization
└── Project
    └── Issue
        └── Execution Workspace
            ├── Repository checkout
            ├── Branch
            ├── Agent session
            ├── Processes and dev server
            ├── Diff
            ├── Review comments
            └── Pull request or merge
```

The central distinction is:

- An **Issue** describes what should be done.
- An **Execution Workspace** is where an agent does it.

One Issue may have multiple Execution Workspaces. An agent starts when an Execution Workspace is created, not when an Issue merely exists on the board.

The end-to-end flow is:

```text
create issue
→ write the prompt
→ set status, priority, assignee, and tags
→ create execution workspace
→ choose repository, base branch, and agent configuration
→ agent executes
→ inspect logs, terminal, diff, or preview
→ leave inline review comments
→ send feedback to the agent
→ repeat until satisfied
→ create pull request or merge locally
```

## Scope of the core product

### Planning

- Organization and Project containers
- Kanban Issues
- Human-facing Issue Status
- Priority
- Assignee
- Tags
- Manual ordering and filtering
- Parent and sub-issues
- Blocking, related, and duplicate relationships

### Execution

- Multiple Execution Workspaces per Issue
- Repository and base-branch selection
- Git worktree and branch creation
- Agent configuration and Session
- Terminal and process logs
- Dev-server preview
- Agent conversation and follow-up prompts

### Review and delivery

- Changed-file and diff inspection
- Inline review comments
- Feedback sent back to the agent
- Repeated execution and review rounds
- Local merge
- Pull request creation and merge

## Explicitly deferred

The following are not part of the first Project Work scope:

- Teams and multi-team Projects
- Initiatives
- Milestones
- Cycles
- Project status updates
- Portfolio or roadmap reporting
- General project documents
- Enterprise permission matrices
- Broad external integration directories
- Glossary and Decision surfaces as Project Work navigation concepts

Existing Kira domain records such as Decisions, Outcomes, Glossary entries, Claims, Workers, and Transcripts may continue to support the implementation, but they are not additional planning surfaces in the first Vibe Kanban-shaped product.

## Consequences

- Project Work has one clear user journey rather than a portfolio-management platform.
- The existing Kira `Ticket` can remain the durable server object while the user-facing model moves toward `Issue` vocabulary.
- The existing Kira `Run`, `Claim`, `Worker`, and `Transcript` should be evaluated as implementation support for Execution Workspace and Session rather than exposed as separate planning concepts.
- The local folder currently called a workspace must be understood as an execution workspace, not as the organization's shared planning scope.
- Planning features should be added only when they improve the issue-to-agent-to-review loop.

## Sources

- Vibe Kanban repository: https://github.com/BloopAI/vibe-kanban
- Vibe Kanban issue flow: `docs/issue-management.mdx`
- Vibe Kanban onboarding flow: `docs/getting-started.mdx`
- Vibe Kanban review flow: `docs/reviewing-code.mdx`
- Vibe Kanban core types: `crates/api-types/src/issue.rs`, `project.rs`, `workspace.rs`, and `issue_relationship.rs`
- Kira's existing project/workspace split: `docs/adr/0010-work-is-tracked-against-a-project.md`
