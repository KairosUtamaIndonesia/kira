/**
 * Asking git what is in a folder, and what it hides.
 *
 * Kira owns no gitignore matcher: nested ignore files, negations,
 * directory-only patterns, `info/exclude` and the operator's own excludes are
 * all git's to apply, and it applies them in a few milliseconds — measured at
 * 3–15 ms against 289–423 ms for a walk of our own
 * (docs/adr/0014-the-workbench-asks-git-what-to-hide.md).
 *
 * `simple-git` is how git is run, and it is a way of running the binary rather
 * than a second git: it spawns the same `git` and parses what comes back, so the
 * answers are still git's own. It is here for the parsing — a status answer is
 * NUL-separated, holds renames as two paths, and quotes anything odd, and that
 * is a library's to get right rather than ours.
 *
 * Every command runs in the folder being listed, so the paths that come back
 * are relative to it and the query is scoped to it by where it is run rather
 * than by a pathspec that has to be kept in step with the folder.
 */
import { simpleGit } from 'simple-git';

/**
 * The files git names in `folder`, relative to it, or null when git cannot
 * answer.
 *
 * No git on the machine and a folder that is not a checkout are one answer
 * rather than two, because they mean one thing to the tree: nothing was
 * filtered, and the workbench says so. The macOS `git` that is a Command Line
 * Tools shim fails here like anything else that cannot answer; a machine where
 * that matters is ADR 0014's revisit condition.
 */
export async function listedByGit(folder: string): Promise<string[] | null> {
  try {
    // Everything git knows that is not ignored: files it tracks, and files it
    // has not been told about yet. The exclusions are git's own, which is the
    // whole point of asking it.
    const named = await simpleGit(folder).raw(['ls-files', '-co', '--exclude-standard', '-z']);

    return splitListing(named);
  } catch {
    return null;
  }
}

/**
 * The paths git reports as changed in `folder`, relative to it, or null when git
 * cannot answer.
 *
 * What has changed is git's to say, the same way what is hidden is, and it is
 * asked once for the folder being listed rather than once per row. No diff, no
 * staging and no other verb: this reads what git already knows, and a rename
 * counts as the name the file has now — the one the tree draws — rather than the
 * one it had.
 *
 * The paths come back relative to the folder rather than to the repository,
 * which takes a second question: git answers a status query with paths from the
 * repository root however it was asked, so the folder's own prefix is taken off
 * each one. `-- .` is what scopes the answer to the folder, and it is why every
 * path has that prefix to begin with — a workspace that is a folder inside a
 * larger checkout is exactly this case.
 */
export async function changedByGit(folder: string): Promise<string[] | null> {
  try {
    const git = simpleGit(folder);
    const [status, prefix] = await Promise.all([
      git.status(['.']),
      git.revparse(['--show-prefix']),
    ]);
    // Every entry git reports is a change, untracked files included — they are
    // in `files` with `?` in the working directory column, which is why nothing
    // is added from `not_added` beside them. Sorted, so the same folder is
    // described the same way twice running rather than in git's own order.
    const paths = status.files.map((file) => file.path).sort();

    return insideFolder(paths, prefix.trim());
  } catch {
    return null;
  }
}

/**
 * The paths of git's status answer as paths from the folder it was asked about.
 *
 * `prefix` is where the folder sits in the checkout, `''` for its root. A path
 * that does not begin with it is not in this folder and is not marked, which the
 * pathspec already prevents and this does not take on trust.
 */
export function insideFolder(paths: readonly string[], prefix: string): string[] {
  if (prefix === '') return [...paths];

  return paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

/**
 * The paths in git's answer to a `-z` listing.
 *
 * NUL-separated rather than newline-separated, because a path may hold either
 * and, this way, the quotes git would otherwise wrap it in never appear. The
 * separator after the last path is not a path.
 */
export function splitListing(output: string): string[] {
  return output.split('\0').filter((path) => path !== '');
}
