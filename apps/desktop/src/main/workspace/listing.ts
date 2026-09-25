/**
 * What one folder of a workspace holds.
 *
 * A level at a time, and only the levels that have been asked for: a folder
 * nobody has opened is not read, which is what keeps a workspace of sixty
 * thousand files as fast to draw as an empty one — nothing here is virtualized,
 * so what the tree is handed is exactly the rows on screen
 * (docs/internal/desktop-conventions.md).
 *
 * The filtered answer is git's rather than ours (ADR 0014). A folder git cannot
 * answer for — not a checkout, or no git on the machine — is read as it is and
 * says so, because a filter that was never applied must not look like one that
 * was. The marks on the rows are git's answer too, and they are asked for beside
 * the listing rather than once per row.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FolderListing, WorkspaceEntry } from '../../preload/bridge.ts';
import { changedByGit, listedByGit } from './git.ts';

/**
 * What one folder holds, whether git was the one who said so, and which of its
 * paths git reports as changed.
 *
 * `path` is how the folder is named from the workspace root — '' for the root
 * itself — and the entries come back with that path already prefixed, so the
 * window can hand any one of them straight back. The changed paths are named the
 * same way, which is what lets a row be marked by comparing the two.
 */
export async function listFolder(root: string, path: string): Promise<FolderListing> {
  const folder = path === '' ? root : join(root, path);
  // Asked together: two questions about one folder, neither waiting on the other.
  const [named, changed] = await Promise.all([listedByGit(folder), changedByGit(folder)]);

  if (named !== null) {
    return {
      entries: childrenOf(named, path),
      filtered: true,
      changed: namedFrom(changed, path),
    };
  }

  const found = await readdir(folder, { withFileTypes: true });
  const listing = nothingFound();

  for (const item of found) {
    keep(listing, { name: item.name, path: at(path, item.name), kind: kindOf(item) });
  }

  // Nothing is marked, because git could not answer — which is not the same as
  // nothing having changed, so the pane says which of the two it is.
  return { entries: drawn(listing), filtered: false, changed: null };
}

/**
 * The changed paths named the way the rows are, from the workspace root.
 *
 * git answers about the folder it was asked about; the tree names everything
 * from the workspace, so the folder's own path goes back on the front.
 */
function namedFrom(changed: readonly string[] | null, folder: string): string[] | null {
  return changed === null ? null : changed.map((one) => at(folder, one));
}

/**
 * The entries one folder holds, from the paths git named inside it.
 *
 * A path with a separator is a folder, because something is under it; a path
 * with none is a file. That is the whole of the difference, and it is why a
 * folder with nothing in it cannot appear: git cannot track an empty directory
 * either, so the tree and git agree rather than merely looking similar.
 *
 * `folder` is where these paths were named from, as a path from the workspace
 * root, and it is prefixed onto each entry.
 */
export function childrenOf(named: readonly string[], folder: string): WorkspaceEntry[] {
  const listing = nothingFound();

  for (const path of named) {
    const cut = path.indexOf('/');
    const name = cut === -1 ? path : path.slice(0, cut);

    // A path git gave that names the folder itself, or a second separator: not
    // a row.
    if (name === '') continue;

    keep(listing, { name, path: at(folder, name), kind: cut === -1 ? 'file' : 'folder' });
  }

  return drawn(listing);
}

/** What has been found in one folder, split the way it is drawn. */
interface Found {
  folders: Map<string, WorkspaceEntry>;
  files: Map<string, WorkspaceEntry>;
}

function nothingFound(): Found {
  return { folders: new Map(), files: new Map() };
}

function keep(found: Found, entry: WorkspaceEntry): void {
  const held = entry.kind === 'folder' ? found.folders : found.files;
  held.set(entry.name, entry);
}

/** The path from the workspace root, which is what the window names it by. */
function at(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/**
 * A symbolic link is a file whatever it points at, which is also how git reads
 * one: the tree draws it as something that can be opened, not as a folder it
 * would have to follow.
 */
function kindOf(item: { isDirectory(): boolean }): WorkspaceEntry['kind'] {
  return item.isDirectory() ? 'folder' : 'file';
}

/** Folders before files, each alphabetical and case-insensitive. */
function drawn(found: Found): WorkspaceEntry[] {
  const order = (one: WorkspaceEntry, other: WorkspaceEntry): number =>
    byName(one.name, other.name);

  return [...[...found.folders.values()].sort(order), ...[...found.files.values()].sort(order)];
}

/**
 * Alphabetical, ignoring case, and decided entirely by the names: two entries
 * differing only in case still have one order rather than whatever order they
 * arrived in, so the same folder draws the same way twice running.
 */
function byName(one: string, other: string): number {
  const folded = one.toLowerCase();
  const against = other.toLowerCase();

  if (folded !== against) return folded < against ? -1 : 1;

  return one === other ? 0 : one < other ? -1 : 1;
}
