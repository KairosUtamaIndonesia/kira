import type { Project, Session } from "./types";

function sessionRootPath(project: Project, session: Session) {
  if (session.rootKind === "projectFolder") {
    return project.folderPath;
  }

  if (session.worktreePath === null) {
    throw new Error(`Worktree Session ${session.id} is missing its worktree path.`);
  }

  return session.worktreePath;
}

export { sessionRootPath };
