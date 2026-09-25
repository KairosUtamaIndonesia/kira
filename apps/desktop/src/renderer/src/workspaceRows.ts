/**
 * What the workspace tree draws, and what it leaves alone.
 *
 * A level at a time: a folder's contents are in here only once that folder has
 * been read, so nothing that has not been opened is drawn, and nothing that is
 * drawn was read for a different folder. That is what makes a workspace of sixty
 * thousand files as cheap to look at as an empty one.
 *
 * Kept away from the component that paints it, the way the chat ordering is, so
 * the rules — what is a row, what hangs under what, and what a folder with
 * nothing in it says — are checkable without a DOM.
 */
import type { FolderListing, Result, WorkspaceEntry } from '../../preload/bridge';

/** What one folder turned out to hold, once it has been asked for. */
export type Read =
  | {
      kind: 'entries';
      entries: WorkspaceEntry[];
      filtered: boolean;
      /** What git reports as changed under it, or null when git could not say. */
      changed: string[] | null;
    }
  /** The chat has nothing said in it yet, so it has no folder to show. */
  | { kind: 'no-workspace' }
  | { kind: 'failed'; reason: string };

/** What has been read, by folder path, with the workspace itself under ''. */
export type Reads = ReadonlyMap<string, Read>;

/**
 * One row of the tree.
 *
 * A folder carries `unopened` rather than a callback: opening it is what reads
 * it, and that is the pane's to do — a row only says whether it has been read.
 * A file carries whether git reports it as changed, which is the only mark the
 * tree draws; a folder is not marked for what changed under it, because the mark
 * is about a file rather than about everything below one.
 *
 * Every folder carries children, an unopened one included — see `unread` for
 * why that is not decoration.
 */
export type Row =
  | { kind: 'folder'; path: string; name: string; unopened: boolean; children: Row[] }
  | { kind: 'file'; path: string; name: string; changed: boolean }
  /**
   * Something worth saying where a folder's contents would be. A notice that
   * names a folder is what reads it, and one that does not is only a sentence.
   */
  | { kind: 'notice'; id: string; label: string; opens?: string };

/** The rows under a folder. Nothing is under one that has not been read. */
export function rowsIn(read: Reads, folder: string): Row[] {
  const held = read.get(folder);

  // Only the workspace itself is ever answered with no workspace; a folder
  // inside one that exists has something to say either way.
  if (held === undefined || held.kind === 'no-workspace') return [];
  if (held.kind === 'failed') return [notice(folder, held.reason)];
  if (held.entries.length === 0) return [notice(folder, 'Nothing in this folder.')];

  // What git reported, as a set to ask once per row rather than once per row per
  // changed path.
  const marked = new Set(held.changed ?? []);

  return held.entries.map((entry) =>
    entry.kind === 'folder'
      ? folderRow(read, entry)
      : { kind: 'file', path: entry.path, name: entry.name, changed: marked.has(entry.path) },
  );
}

function folderRow(read: Reads, entry: WorkspaceEntry): Row {
  const unopened = !read.has(entry.path);

  return {
    kind: 'folder',
    path: entry.path,
    name: entry.name,
    unopened,
    children: unopened ? [unread(entry.path)] : rowsIn(read, entry.path),
  };
}

/**
 * What an unopened folder holds until it is read, and what reads it when it is
 * clicked.
 *
 * A folder that has not been read is a folder all the same, and the tree is told
 * so: Astryx indents a row by a chevron column's width only when the tree holds
 * an expandable row *somewhere*, so a tree of nothing but leaves sits flush and
 * the first folder opened would shove every row sideways by 24px. Carrying this
 * row from the first paint is what keeps every row where it was drawn.
 */
function unread(folder: string): Row {
  return { kind: 'notice', id: `/${folder}`, label: 'Not read yet.', opens: folder };
}

/**
 * A row that says something rather than naming something. Its id cannot be a
 * path, since no path from the workspace root begins with a separator.
 */
function notice(folder: string, label: string): Row {
  return { kind: 'notice', id: `/${folder}`, label };
}

/** What the channel answered, as the tab holds it. */
export function readingOf(result: Result<FolderListing | null>): Read {
  if (!result.ok) return { kind: 'failed', reason: result.error };
  if (result.value === null) return { kind: 'no-workspace' };

  return {
    kind: 'entries',
    entries: result.value.entries,
    filtered: result.value.filtered,
    changed: result.value.changed,
  };
}
