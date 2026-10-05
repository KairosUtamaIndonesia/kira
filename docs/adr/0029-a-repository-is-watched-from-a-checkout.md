# A repository is watched from a checkout

Date: 2026-10-05

Amends ADR 0026 (a repository is attached from a checkout, not named on its own).

## Context

ADR 0026 made a project hold its repositories — *"a provider, an owner and a name, attached to a project"* — and called a repository *"the thing a run will clone from"*. The desktop's **Repositories** dialog was how a person attached one: typing an owner and a name, or picking from the repositories a connected GitHub App can see.

That dialog is a second door onto work the workspace flow already does. Opening a folder is how a project comes into being and how a machine joins it (ADR 0010), and the folder already knows which repository it is — `git remote get-url origin` answers provider, owner and name, and `hasRemote` already runs git in that folder and throws the URL away (`apps/desktop/src/main/workspace/git.ts`).

What made the dialog look necessary is thin. The `repository` table has one consumer: resolving an incoming webhook to a project, by provider and owner and name (`apps/server/src/git.ts`, in `mirror` and `applyCheck`). Nothing else reads it. No run clones from it. And the rows are server-side and shared, so one person's checkout attaches the repository for everyone — a machine with no folder does not need a row of its own.

ADR 0010's reasoning against guessing was about *project* identity, where a folder may have no remote, or two, or a fork's, and it still holds. Inferring the *repository* is a narrower question with an unambiguous answer whenever there is one remote to read, and a folder with none simply attaches nothing.

## Decision

**A repository is watched from a checkout.** A project names a repository when, and only when, someone opens a folder that is one, or clones one: the folder's remote says which repository it is, and that is what attaches it. There is no way to name a repository without a checkout.

**A folder that is not a repository is an ordinary workspace.** A scratch directory, a folder of notes and a checkout with no remote are all the same outcome — a workspace with nothing attached — and nothing in the flow requires a repository to exist (ADR 0010).

**A connected host is never a gate.** Attaching a repository needs no connection; a connection is what makes webhooks arrive. It is offered as a next step and never blocks a workspace.

**A repository belongs to one project.** Two projects watching one repository would make a delivery's project ambiguous, because routing takes the first matching row. Where a repository is already attached elsewhere, the answer is to work the project that holds it.

## Consequences

- **A project whose repository nobody has cloned cannot be watched.** That is the accepted cost. The revisit condition is a headless run that needs the list without a folder, which ADR 0026 anticipated and which does not exist yet.
- **The desktop's Repositories dialog and the repository picker inside it are removed.** The new-workspace flow becomes the only place a repository is attached, and it carries two entry points: a folder you already have, or a repository cloned on your behalf.
- **The server keeps both of its repository routes.** `POST /api/projects/:ref/repositories` still attaches, and `GET /api/git/connections/:id/repositories` still lists what an installation can see, because the clone entry point chooses from that list.
