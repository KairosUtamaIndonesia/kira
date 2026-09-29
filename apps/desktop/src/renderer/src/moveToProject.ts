/**
 * What moving a chat into a project is decided from, away from the dialog that asks.
 *
 * Approving anything Kira proposed writes it to a project, and a project is reached through
 * the folder a chat works in — so a chat whose folder is in no project has nowhere to write
 * it. These say when that is, and which folders a chat could be moved to.
 */
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';

/** A folder that is in a project, and the project as the server lists it. */
export interface Place {
  workspace: WorkspaceSummary;
  /** Undefined when the server did not list the project: the folder is still a place. */
  project: ProjectSummary | undefined;
}

/**
 * Whether a chat has nowhere to write what it proposes: it is filed under no folder, a
 * folder that has since been forgotten, or a folder that is in no project.
 */
export function needsProject(workspaceId: string | null, workspaces: WorkspaceSummary[]): boolean {
  const workspace = workspaces.find((each) => each.id === workspaceId);

  return workspace === undefined || workspace.projectId === null;
}

/** The folders a chat could be moved to: the ones already in a project, in the order held. */
export function placesOf(workspaces: WorkspaceSummary[], projects: ProjectSummary[]): Place[] {
  return workspaces
    .filter((each) => each.projectId !== null)
    .map((each) => ({
      workspace: each,
      project: projects.find((project) => project.id === each.projectId),
    }));
}
