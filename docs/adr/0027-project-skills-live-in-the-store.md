# A project's skills live in the store

Date: 2026-10-02

Amends ADR 0022 ("a project cannot change the bundled skills in the first
version") and answers ADR 0001's revisit condition for skills specifically:
importing a skill over the network stays out of scope until the write-approval
question is answered.

## Context

ADR 0022 made Kira ship her own trimmed set of skills inside the app and pick
one herself. The set has not moved since: eleven directories under
`apps/desktop/resources/skills/`, discovered by pi through
`additionalSkillPaths` (`apps/desktop/src/main/pi/agent.ts`), with a workspace's
own `.agents/skills` loading beside them.

Two gaps that decision left in writing have now been felt.

The first is that a project cannot add a method of its own. A team that reviews
every change against its own checklist has nowhere to put the checklist: the
bundled set is compiled into the app, and `.agents/skills` in a working folder
is a file a person edits by hand rather than something the project holds. Every
project sharing a folder-level convention also shares it with every other
project that uses that folder.

The second is that a skill is not shareable. A skill written on one person's
machine reaches a colleague only by copying files. ADR 0001 named this as the
condition under which Kira's absent filesystem boundary stops being only the
user's own risk, and it is the reason the boundary question has to be settled
here rather than later.

Multica has built this surface and is the reference for its shape: a `skill`
row per workspace, `skill_file` rows beside it for reference material, and a
junction when a skill is attached to an agent. Its documentation states plainly
what it does not do — imported skills "may contain scripts, commands, or unsafe
instructions" and "Multica does not review, sign, or sandbox them". That
warning costs Multica little, because it has no filesystem boundary to lose.
## Decision

**A project holds its own skills.** A skill is a name, a description, a body,
and optional supporting files, scoped to a project and written and read through
Kira's server like the Glossary and the Decisions are (ADR 0020). It is
delivered to a chat by being written into a directory beside the bundled set,
which is the Kira-owned path `apps/desktop/src/main/pi/agent.ts` already hands
to pi.

**The bundled set stays the floor.** It does not move into the store, and a
project cannot replace or remove it. Kira keeps picking the skill the work
wants (ADR 0022); a project's skills are additions she may reach for, not a
rewrite of the workflow. A project skill that shares a bundled skill's name is
refused rather than allowed to shadow it, because the router names the bundled
skills by that name.

**A skill's name is a slug and its description is required.** pi loads a skill
whose frontmatter `name` is missing by falling back to the directory name, and
warns on a name that is not lowercase letters, digits and single hyphens
(`dist/core/skills.js`). Kira validates both at the route and writes the
frontmatter itself, so the store holds one shape and no parser has to reconcile
a person's YAML with pi's rules. A skill whose description is empty does not
load at all, which makes the description a required field rather than a nicety.

**Import is not in this version.** There is no import from a URL, no archive
upload, and no provenance to refresh from. A skill in Kira is written in Kira
by someone signed in to Kira. ADR 0001's revisit condition is therefore not
triggered by this decision — nothing here is remote content reaching a local
shell — and it is the condition to satisfy before import is added: either
approval gates on writes outside the working directory, or an explicit
statement of why imported instructions do not need one.

**A skill Kira writes is a file a person can also see.** The materialized
directory is Kira's own, named for the project's skills and outside the
person's `.agents/skills`, so a chat keeps working in a folder whose contents
Kira does not own, and a stale copy left behind by a removed skill is Kira's to
clear rather than the person's to tidy.
Kira states in ADR 0001 that the working folder "protects nothing". Bringing
remote instructions inside that boundary would spend the one thing that
decision leans on.

## Considered options

- **Put skills in the app's SQLite store instead of the server.** Cheaper, and
  it would have kept the feature off the server entirely. It fails the reason
  the gap was felt: a skill in a per-machine database is precisely the
  unshareable file the decision is meant to replace, and it would have to move
  later anyway.
- **Let a project shadow a bundled skill.** It reads as the flexible choice,
  and it breaks the router: ADR 0022 puts the router in the system prompt on
  every turn and it names the bundled skills, so a shadowed name makes the
  router's instructions point at different behaviour in different projects with
  nothing telling the model that.
- **Carry Multica's whole skill system across.** Bundles, content hashes, a
  resolve endpoint and a cache exist to move skills from a server to many
  daemons over a network, with per-runtime discovery paths for thirty-odd agent
  CLIs. Kira has one runtime, one machine per person, and the files are already
  local. The transport would be machinery serving a problem Kira does not have.
- **Let a project attach a skill to one chat rather than to the project.** It
  matches how a workspace's `.agents/skills` already behaves, and it makes the
  project the wrong scope: a project is the shared body of work (ADR 0010), so
  the checklist belongs to it, and per-chat attachment would mean unlike chats
  in one project run against unlike methods.
- **Import from a URL in the first version.** It is the feature that makes a
  skill shareable across companies rather than within one. It also introduces
  remote instructions into an agent with the user's whole account reachable
  (ADR 0001), which is a decision to make deliberately rather than as a side
  effect of building an editor.
## Consequences

- **ADR 0022's "a project cannot change the bundled skills" is narrowed, not
  reversed.** Which skill the work wants is still Kira's; what exists is the
  project's.
- **A project skill is delivered to every chat in the project**, including one
  opening in a folder that never saw the skill before, because it is written
  into the materialized directory at chat start rather than read from the
  folder.
- **A skill removed from a project stops reaching chats**, and its directory is
  cleared from the materialized path. A chat already running keeps the skill it
  started with; the next one it starts does not have it.
- **A person's own `.agents/skills` still load.** They are part of the folder
  the person chose (ADR 0022) and are not affected by a project's skills, other
  than an outright name collision, which pi resolves by whichever root it reads
  first rather than by Kira.
- **Nothing about a skill's body is validated.** It is Markdown that becomes
  instructions, exactly as a bundled skill is. The guard is that a person wrote
  it and is signed in, which is the guard ADR 0001 already relies on.
- **Import is the next decision, and it is a decision rather than a ticket.**
  The shape it would take — a `.skill` archive, a URL, a Git path — does not
  need settling until the boundary question above is answered.

## Sources

- Multica's skill model and its import warning:
  `server/migrations/008_structured_skills.up.sql`,
  `apps/docs/content/docs/skills.mdx`.
- pi's skill discovery and its name and description rules:
  `@earendil-works/pi-coding-agent/dist/core/skills.js`,
  `dist/core/resource-loader.js`.
- Kira's bundled set and how it reaches pi: `apps/desktop/resources/skills/`,
  `apps/desktop/src/main/pi/resources.ts`, `apps/desktop/src/main/pi/agent.ts`;
  ADR 0002, ADR 0022.