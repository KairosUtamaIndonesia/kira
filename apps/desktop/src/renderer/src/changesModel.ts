/**
 * The pure rules behind the Changes view.
 *
 * What a changed list holds and how a patch splits into hunks, kept out of the
 * component that paints them so both are checkable without a DOM — the same
 * shape the tree's rows take. Nothing here talks to the main process: it decides
 * what a status means once it has arrived.
 */
import type { WorkspaceGitStatus } from '../../preload/bridge.ts';

/** Whether a file has nothing, some, or all of its changes in the index. */
export type FileState = 'staged' | 'partial' | 'unstaged';

/** One changed path, however many places git lists it. */
export interface ChangedFile {
  path: string;
  /** git's code for it: the index's when something is staged, else the working tree's. */
  status: string;
  state: FileState;
  isUntracked: boolean;
  /** Lines added and removed, or null when git cannot count them (untracked, binary). */
  added: number | null;
  removed: number | null;
}

/**
 * Every changed path once, in path order.
 *
 * git lists a file in the index and in the working tree separately, so a file
 * edited after it was staged comes twice; here that is one file whose state is
 * `partial`. The order is the path's, not the state's, so staging a file never
 * moves its row.
 */
export function changedFiles(status: WorkspaceGitStatus): ChangedFile[] {
  const files = new Map<string, ChangedFile>();

  for (const file of status.untracked) {
    files.set(file.path, {
      path: file.path,
      status: '?',
      state: 'unstaged',
      isUntracked: true,
      added: null,
      removed: null,
    });
  }

  const staged = new Map(status.staged.map((file) => [file.path, file]));
  const unstaged = new Map(status.unstaged.map((file) => [file.path, file]));
  for (const path of new Set([...staged.keys(), ...unstaged.keys()])) {
    const inIndex = staged.get(path);
    const inTree = unstaged.get(path);
    const held = [inIndex, inTree].filter((file) => file !== undefined);

    files.set(path, {
      path,
      status: (inIndex ?? inTree)!.status,
      state: inIndex === undefined ? 'unstaged' : inTree === undefined ? 'staged' : 'partial',
      isUntracked: false,
      added: sumOf(held.map((file) => file.added)),
      removed: sumOf(held.map((file) => file.removed)),
    });
  }

  return [...files.values()].sort((one, other) => (one.path < other.path ? -1 : 1));
}

function sumOf(counts: (number | undefined)[]): number | null {
  const known = counts.filter((count) => count !== undefined);

  return known.length === 0 ? null : known.reduce((sum, count) => sum + count, 0);
}

/** How many files a commit would hold: any with something in the index. */
export function committingCount(files: readonly ChangedFile[]): number {
  return files.filter((file) => file.state !== 'unstaged').length;
}

/** The lines added and removed across the files git could count. */
export function totalsOf(files: readonly ChangedFile[]): { added: number; removed: number } {
  return {
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
  };
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

/**
 * The levels the Changes view watches: the workspace root, and the folder of
 * every changed path. A change is watched where it is, because `fs.watch` is not
 * recursive — watching only the root would miss an edit to a file in a subfolder,
 * and watching a changed file's own folder is what keeps its diff current.
 */
export function watchedFoldersOf(status: WorkspaceGitStatus | null): string[] {
  const folders = new Set<string>(['']);
  if (status !== null) {
    for (const file of [...status.staged, ...status.unstaged, ...status.untracked]) {
      const cut = file.path.lastIndexOf('/');
      if (cut > 0) folders.add(file.path.slice(0, cut));
    }
  }

  return [...folders];
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

/**
 * What a hunk is called: the function or section git found it in, which it
 * writes after the second `@@`, else the line it starts on.
 */
export function hunkLabel(hunk: string): string {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/m.exec(hunk);
  if (match === null) return 'Changes';
  const [, start = '1', section = ''] = match;

  return section.trim() === '' ? `Line ${start}` : section.trim();
}

/** How long ago a commit was made, as short as a chat's age: `now`, `5m`, `3h`, `2d`, `6w`. */
export function ageOf(date: string, now: number): string {
  const then = Date.parse(date);
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;

  return `${Math.floor(minutes / (60 * 24 * 7))}w`;
}

/** One piece of a file's diff that can be staged or unstaged on its own. */
export interface DiffBlock {
  key: string;
  label: string;
  /** A patch git can apply: the file header and this one hunk. */
  patch: string;
  /** Whether it is in the index already, so acting on it takes it back out. */
  staged: boolean;
  /** Whether it is the file's whole patch because git found no hunks in it (binary, mode). */
  isWhole: boolean;
}

/** A patch as the blocks the review stages one by one; nothing when there is no patch. */
export function blocksOf(patch: string | null, staged: boolean): DiffBlock[] {
  if (patch === null || patch.trim() === '') return [];

  const { hunks } = hunksOf(patch);
  if (hunks.length === 0) {
    return [{ key: `${staged}:whole`, label: 'Changes', patch, staged, isWhole: true }];
  }

  return hunks.map((hunk, at) => ({
    key: `${staged}:${at}:${hunk}`,
    label: hunkLabel(hunk),
    patch: hunkPatch(patch, at) ?? patch,
    staged,
    isWhole: false,
  }));
}
