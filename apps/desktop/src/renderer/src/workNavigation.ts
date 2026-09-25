import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';

/** Which local workspace can open a project's queue. */
export function projectWorkspaces(
  project: ProjectSummary,
  workspaces: readonly WorkspaceSummary[],
): WorkspaceSummary[] {
  return workspaces.filter((workspace) => workspace.projectId === project.id);
}

export function destinationForProject(
  project: ProjectSummary,
  workspaces: readonly WorkspaceSummary[],
):
  | { kind: 'open'; workspace: WorkspaceSummary }
  | { kind: 'choose'; workspaces: WorkspaceSummary[] }
  | { kind: 'link' } {
  const linked = projectWorkspaces(project, workspaces);
  if (linked.length === 1) return { kind: 'open', workspace: linked[0]! };
  if (linked.length > 1) return { kind: 'choose', workspaces: linked };
  return { kind: 'link' };
}
