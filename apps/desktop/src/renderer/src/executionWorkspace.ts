import type { ExecutionWorkspace, Ticket, TicketRun } from '../../preload/bridge.ts';

export type ExecutionStatus = 'not-started' | 'running' | 'completed' | 'failed';

export interface ExecutionWorkspaceView {
  workspace: ExecutionWorkspace;
  status: ExecutionStatus;
  run: TicketRun | null;
  repository: string;
  branch: string;
  changed: string | null;
  processes: string[];
  preview: { url: string } | null;
}

/**
 * The issue-facing reading of an execution workspace.
 *
 * A workspace can exist before its first run. Once a run exists, its end and
 * stopped reason are the source of truth for what the person sees. Preview is
 * deliberately absent until the workspace contract names one.
 */
export function executionWorkspaceView(
  workspace: ExecutionWorkspace,
  ticket: Pick<Ticket, 'runs'>,
): ExecutionWorkspaceView {
  const run = ticket.runs.find((candidate) => candidate.branch === workspace.branch) ?? null;
  const status: ExecutionStatus =
    run === null
      ? 'not-started'
      : run.endedAt === null
        ? 'running'
        : run.stoppedBecause === null
          ? 'completed'
          : 'failed';

  return {
    workspace,
    status,
    run,
    repository: workspace.repository,
    branch: workspace.branch,
    changed: run?.changed ?? null,
    processes: run?.checks ?? [],
    preview: null,
  };
}

export function executionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case 'not-started':
      return 'Not started';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
  }
}

export function executionPreviewLabel(preview: ExecutionWorkspaceView['preview']): string {
  return preview === null ? 'No development preview is available.' : preview.url;
}
