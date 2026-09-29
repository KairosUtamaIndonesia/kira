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

export interface ExecutionDiffLine {
  kind: 'meta' | 'hunk' | 'context' | 'added' | 'removed';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ExecutionDiffFile {
  path: string;
  lines: ExecutionDiffLine[];
}

/** Parse unified diff hunks so review comments can target the new-file line. */
export function executionDiffFiles(diff: string): ExecutionDiffFile[] {
  const files: ExecutionDiffFile[] = [];
  let current: ExecutionDiffFile | null = null;
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      current = { path: 'unknown file', lines: [] };
      files.push(current);
      oldLine = null;
      newLine = null;
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
      continue;
    }
    if (current === null) continue;

    if (text.startsWith('--- ')) {
      if (current.path === 'unknown file' && text !== '--- /dev/null') {
        current.path = diffPath(text.slice(4));
      }
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
      continue;
    }
    if (text.startsWith('+++ ')) {
      if (text !== '+++ /dev/null') current.path = diffPath(text.slice(4));
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      current.lines.push({ kind: 'hunk', text, oldLine: null, newLine: null });
      continue;
    }

    if (oldLine === null || newLine === null) {
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
    } else if (text.startsWith('+')) {
      current.lines.push({ kind: 'added', text: text.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (text.startsWith('-')) {
      current.lines.push({ kind: 'removed', text: text.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (text.startsWith('\\')) {
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
    } else if (text.startsWith(' ')) {
      current.lines.push({ kind: 'context', text: text.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      current.lines.push({ kind: 'meta', text, oldLine: null, newLine: null });
    }
  }

  return files.filter((file) => file.lines.some((line) => line.kind === 'hunk'));
}

function diffPath(header: string): string {
  const path = header.replace(/^([ab])\//, '');
  return path.startsWith('"') ? path.slice(1, -1) : path;
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

/** Avoid suggesting a branch already assigned to another workspace on this issue. */
export function suggestExecutionBranch(baseBranch: string, existing: readonly string[]): string {
  const used = new Set(existing);
  if (!used.has(baseBranch)) return baseBranch;

  let suffix = 2;
  while (used.has(`${baseBranch}-${suffix}`)) suffix += 1;
  return `${baseBranch}-${suffix}`;
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

/** What a workspace's state asks of a person, as the ticket's box says it. */
export function workspaceStateWords(status: ExecutionStatus): string {
  switch (status) {
    case 'not-started':
      return 'Not started';
    case 'running':
      return 'Agent working';
    case 'completed':
      return 'Ready to review';
    case 'failed':
      return 'Stopped';
  }
}

/**
 * A long branch shortened to `keep` characters in the middle, not at the end: branches for
 * one project share their start and differ at their ends, so both have to survive.
 */
export function shortenMiddle(text: string, keep: number): string {
  if (text.length <= keep) return text;

  const head = Math.ceil((keep - 1) * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - 1 - head))}`;
}

/** A checkout under the home folder, written from `~` as a terminal would show it. */
export function fromHome(path: string): string {
  return path.replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, '~').replace(/(.)\/$/, '$1');
}
