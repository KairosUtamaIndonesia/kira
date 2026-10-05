/**
 * The pure rules behind the Changes view.
 *
 * What a changed list holds and how a patch splits into hunks, kept out of the
 * component that paints them so both are checkable without a DOM — the same
 * shape the tree's rows take. Nothing here talks to the main process: it decides
 * what a status means once it has arrived.
 */
import type { ChangedPath, WorkspaceGitStatus } from '../../preload/bridge.ts';

/** Which group of the changed list a row belongs to. */
export type ChangeGroup = 'staged' | 'unstaged' | 'untracked';

/** One changed path, with the group it is drawn under. */
export interface ChangeRow extends ChangedPath {
  group: ChangeGroup;
}

/** Every changed path as one ordered list, staged first, the way the pane draws them. */
export function changeRows(status: WorkspaceGitStatus): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const file of status.staged) rows.push({ group: 'staged', ...file });
  for (const file of status.unstaged) rows.push({ group: 'unstaged', ...file });
  for (const file of status.untracked) rows.push({ group: 'untracked', ...file });

  return rows;
}

/** How many files a commit would hold. */
export function stagedCount(status: WorkspaceGitStatus): number {
  return status.staged.length;
}

/**
 * The word beside a row: git's code said in a person's words. The first letter
 * is what matters; git writes `??` for untracked and `R100` for a rename.
 */
export function statusWord(code: string): string {
  switch (code[0]) {
    case 'M':
      return 'Modified';
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    case '?':
      return 'Untracked';
    case 'U':
      return 'Conflicted';
    default:
      return 'Changed';
  }
}

/** Whether a row can be put back the way HEAD has it. An untracked file has no such state. */
export function canRevert(row: ChangeRow): boolean {
  return row.group !== 'untracked';
}

/** The identity of a row: one path can be staged and unstaged at once. */
export function rowKey(row: ChangeRow): string {
  return `${row.group}:${row.path}`;
}

/** A patch split into the file header every hunk shares and the hunks themselves. */
export interface PatchHunks {
  header: string;
  hunks: string[];
}

/**
 * Split a unified patch into its file header and its hunks.
 *
 * Everything before the first `@@` is the header — `diff --git`, the modes, the
 * `---`/`+++` pair — and each `@@` line begins a hunk that runs to the next one.
 * A patch with no hunks (a binary change) comes back as a header and nothing.
 */
export function hunksOf(patch: string): PatchHunks {
  const lines = patch.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  if (first === -1) return { header: patch, hunks: [] };

  const hunks: string[] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@')) hunks.push(line);
    else if (hunks.length > 0) hunks[hunks.length - 1] += `\n${line}`;
  }

  return { header: lines.slice(0, first).join('\n'), hunks: hunks.map(trimHunk) };
}

/** One hunk as a patch git can apply: its file header, then the hunk itself. */
export function hunkPatch(patch: string, index: number): string | null {
  const { header, hunks } = hunksOf(patch);
  const hunk = hunks[index];
  if (hunk === undefined) return null;

  return `${header}\n${hunk}\n`;
}

/** A hunk as it was read, without the empty tail one trailing newline leaves. */
function trimHunk(hunk: string): string {
  return hunk.endsWith('\n') ? hunk.slice(0, -1) : hunk;
}
