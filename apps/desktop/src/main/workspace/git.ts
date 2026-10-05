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
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

/**
 * Give a write-capable child its own git worktree, seeded with the parent's
 * tracked edits and visible untracked files. Ignored files stay ignored.
 */
export async function isolatedCheckout(folder: string): Promise<string> {
  const git = simpleGit(folder);
  let root: string;
  try {
    root = (await git.revparse(['--show-toplevel'])).trim();
  } catch {
    throw new Error('A write-capable subagent needs a git checkout to work in isolation.');
  }

  const parentChanges = await simpleGit(root).raw(['diff', '--binary', 'HEAD']);
  const untracked = splitListing(
    await simpleGit(root).raw(['ls-files', '--others', '--exclude-standard', '-z']),
  );
  const temporary = await mkdtemp(join(tmpdir(), 'kira-subagent-'));
  await rmdir(temporary);
  await simpleGit(root).raw(['worktree', 'add', '--detach', temporary, 'HEAD']);

  if (parentChanges !== '') {
    const patch = join(tmpdir(), `kira-subagent-${randomUUID()}.patch`);
    await writeFile(patch, parentChanges);
    try {
      await simpleGit(temporary).raw(['apply', '--binary', patch]);
    } finally {
      await unlink(patch);
    }
  }

  for (const path of untracked) {
    const source = join(root, path);
    const destination = join(temporary, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  return join(temporary, relative(root, folder));
}

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

/** Whether this checkout has a configured remote, or null when git cannot answer. */
export async function hasRemote(folder: string): Promise<boolean | null> {
  try {
    const remotes = await simpleGit(folder).raw(['remote']);

    return remotes.trim() !== '';
  } catch {
    return null;
  }
}

/** A remote a checkout was cloned from, as git names it. */
export interface RepositoryRemote {
  host: string;
  owner: string;
  name: string;
  /** The host Kira can watch this from by itself, or null when it is not one. */
  provider: 'github' | 'gitlab' | null;
}

/** The provider Kira can watch `host` from by itself, or null when it is not one it names. */
export function providerOf(host: string): 'github' | 'gitlab' | null {
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';

  return null;
}

/**
 * The host, owner and name a remote URL names, or null when it names no repository.
 *
 * git writes the same repository in several shapes — `git@github.com:owner/name.git`,
 * `ssh://git@github.com/owner/name.git`, `https://user:token@github.com/owner/name.git` —
 * and the scp-like one is not a URL, so it does not parse as one and is read by hand.
 * Anything left over that names no repository is nothing rather than a guess (ADR 0029).
 *
 * The owner is the first path segment and the name is everything after it, which is how
 * the GitLab adapter already splits a `path_with_namespace`; a nested group has to read
 * the same way in both places, or one repository would be attached twice under two names.
 */
export function parseRemote(url: string): { host: string; owner: string; name: string } | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;

  const held = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? fromUrl(trimmed) : fromScp(trimmed);
  if (held === null) return null;

  const [owner, ...rest] = held.path.split('/').filter((each) => each !== '');
  const name = rest.join('/').replace(/\.git$/i, '');
  if (owner === undefined || name === '') return null;

  return { host: held.host.toLowerCase(), owner, name };
}

function fromUrl(value: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(value);

    return parsed.hostname === '' ? null : { host: parsed.hostname, path: parsed.pathname };
  } catch {
    return null;
  }
}

/** `git@github.com:owner/name.git`, which is how git clones over ssh and is no URL. */
function fromScp(value: string): { host: string; path: string } | null {
  const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
  const host = match?.[1];
  const path = match?.[2];
  if (host === undefined || path === undefined) return null;

  return { host, path };
}

/**
 * The remote a checkout was cloned from, or null when it has none, has more than one
 * and no origin, or git cannot answer.
 *
 * Preferring `origin` is what keeps two remotes answerable: a fork cloned with its
 * upstream still has one origin. A checkout with two remotes and no origin is the case
 * ADR 0010 refused to guess at, and it is refused here too.
 */
export async function remoteOf(folder: string): Promise<RepositoryRemote | null> {
  try {
    const git = simpleGit(folder);
    const named = (await git.raw(['remote']))
      .split('\n')
      .map((each) => each.trim())
      .filter((each) => each !== '');
    const chosen = named.includes('origin') ? 'origin' : named.length === 1 ? named[0] : undefined;
    if (chosen === undefined) return null;

    const parsed = parseRemote(await git.raw(['remote', 'get-url', chosen]));
    if (parsed === null) return null;

    return { ...parsed, provider: providerOf(parsed.host) };
  } catch {
    return null;
  }
}

/** The URL git clones a repository from, or null when Kira does not know the host. */
export function cloneUrl(provider: string, owner: string, name: string): string | null {
  if (provider === 'github') return `https://github.com/${owner}/${name}.git`;
  if (provider === 'gitlab') return `https://gitlab.com/${owner}/${name}.git`;

  return null;
}

/**
 * Clone `url` into a new folder under `parent`, named after the repository, and
 * answer where it landed.
 *
 * The clone runs as the person: git uses the credentials the machine already has,
 * and a repository those cannot read is a refusal raised in git's own words rather
 * than worked around with a token handed down from the server (ADR 0029). The name
 * is the repository's last segment, so a GitLab group does not become a folder of
 * folders.
 */
export async function cloneInto(url: string, parent: string, name: string): Promise<string> {
  const destination = join(parent, basename(name));

  await simpleGit().clone(url, destination);

  return destination;
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

/**
 * The local branches of the checkout at `folder`, and the one it has out, or a thrown
 * error saying why git could not answer — the setup dialog shows that to the person
 * rather than offering a list it made up.
 */
export async function branchesOf(
  folder: string,
): Promise<{ branches: string[]; current: string | null }> {
  let summary;
  try {
    summary = await simpleGit(folder).branchLocal();
  } catch {
    throw new Error('That folder is not a git checkout, or git could not read it.');
  }
  return {
    branches: summary.all,
    current: summary.detached || summary.current === '' ? null : summary.current,
  };
}
