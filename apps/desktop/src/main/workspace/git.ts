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
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type {
  ChangedPath,
  CommitSummary,
  GitSyncAction,
  WorkspaceGitStatus,
} from '../../preload/bridge.ts';
import { runGitOperation } from './gitQueue.ts';

/**
 * The repository root each folder belongs to, remembered so the queue's key is
 * the checkout rather than the folder a command happened to run in: a status
 * read of a subfolder and a stage of the workspace root have to serialise
 * against each other, and they only do when both name the same repository.
 */
const repositoryRoots = new Map<string, string>();

async function repositoryRoot(folder: string): Promise<string> {
  const known = repositoryRoots.get(folder);
  if (known !== undefined) return known;

  let root = folder;
  try {
    root = (await simpleGit(folder).revparse(['--show-toplevel'])).trim() || folder;
  } catch {
    // Not a checkout, or git cannot answer: the folder is its own key, and the
    // command that needed the queue says so in its own words.
  }
  repositoryRoots.set(folder, root);

  return root;
}

/** Run one local-git command against its checkout, one at a time. */
async function onCheckout<T>(folder: string, work: () => Promise<T>): Promise<T> {
  return runGitOperation(await repositoryRoot(folder), work);
}

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
    // Serialised against every other command for this folder: `git status`
    // writes the index, and the tree asks for it on every watcher burst, so an
    // index write must not overlap one of these reads (workspace/gitQueue.ts).
    return await onCheckout(folder, () => readChanged(folder));
  } catch {
    return null;
  }
}

async function readChanged(folder: string): Promise<string[]> {
  const git = simpleGit(folder);
  const [status, prefix] = await Promise.all([git.status(['.']), git.revparse(['--show-prefix'])]);
  // Every entry git reports is a change, untracked files included — they are
  // in `files` with `?` in the working directory column, which is why nothing
  // is added from `not_added` beside them. Sorted, so the same folder is
  // described the same way twice running rather than in git's own order.
  const paths = status.files.map((file) => file.path).sort();

  return insideFolder(paths, prefix.trim());
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
  return paths
    .map((path) => insideOne(path, prefix))
    .filter((path): path is string => path !== null);
}

/**
 * One path of git's answer as a path from the folder it was asked about, or null
 * when it is not in that folder. `prefix` is where the folder sits in the
 * checkout, `''` for its root.
 */
export function insideOne(path: string, prefix: string): string | null {
  if (prefix === '') return path;

  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
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

/** How large a patch the workbench will render: larger than any worth reading here. */
const DIFF_SIZE_CAP = 1024 * 1024;
const DIFF_REFUSAL = 'This diff is larger than the 1 MB the workbench renders.';

/**
 * What git says about the checkout at `folder`: its branch and every changed
 * path, grouped staged, unstaged and untracked. Named from the folder, and the
 * shape is `WorkspaceGitStatus`, which crosses into the window.
 *
 * Thrown rather than answered with an empty list when git cannot read the
 * folder, so a folder that is not a checkout never looks like a clean one.
 */
export async function statusOf(folder: string): Promise<WorkspaceGitStatus> {
  try {
    return await onCheckout(folder, () => readStatus(folder));
  } catch {
    throw new Error('That folder is not a git checkout, or git could not read it.');
  }
}

async function readStatus(folder: string): Promise<WorkspaceGitStatus> {
  const git = simpleGit(folder);
  const [status, prefix] = await Promise.all([git.status(['.']), git.revparse(['--show-prefix'])]);
  const cut = prefix.trim();
  const staged: ChangedPath[] = [];
  const unstaged: ChangedPath[] = [];
  const untracked: ChangedPath[] = [];

  for (const file of status.files) {
    const path = insideOne(file.path, cut);
    if (path === null) continue;
    const from = file.from === undefined ? undefined : (insideOne(file.from, cut) ?? undefined);
    const index = file.index;
    const working = file.working_dir;

    if (index === '?' || working === '?') {
      untracked.push({ path, status: '?' });
      continue;
    }

    if (index !== ' ' && index !== '') {
      staged.push({ path, status: index, ...(from === undefined ? {} : { from }) });
    }
    if (working !== ' ' && working !== '') {
      unstaged.push({ path, status: working, ...(from === undefined ? {} : { from }) });
    }
  }

  return {
    branch: status.detached || status.current === '' ? null : status.current,
    staged,
    unstaged,
    untracked,
  };
}

/**
 * The unified patch for one path — what is in the index when `staged`, what is
 * in the working tree otherwise. An untracked file has no patch of its own, so
 * one is written for it as a new file, which is what the diff pane draws and
 * what staging a hunk applies.
 *
 * A patch larger than the cap is refused with a sentence rather than sent to be
 * rendered, because a generated file's diff can dwarf anything worth reading.
 */
export async function patchOf(folder: string, path: string, staged: boolean): Promise<string> {
  return onCheckout(folder, async () => {
    // A file already over the cap is refused before a diff of it is built, so a
    // generated file is never rendered into a diff only to be thrown away. A
    // path that is not on disk — a deleted file, a rename source — has no size
    // to read and is left to git.
    const size = await stat(join(folder, path)).then(
      (info) => info.size,
      () => null,
    );
    if (size !== null && size > DIFF_SIZE_CAP) throw new Error(DIFF_REFUSAL);

    const git = simpleGit(folder);
    const patch = staged
      ? await git.raw(['diff', '--cached', '--', path])
      : await git.raw(['diff', '--', path]);
    const held = patch === '' && !staged ? await untrackedPatch(folder, path) : patch;

    if (Buffer.byteLength(held, 'utf8') > DIFF_SIZE_CAP) throw new Error(DIFF_REFUSAL);

    return held;
  });
}

/** An untracked file drawn as a new file, or nothing when it is tracked. */
async function untrackedPatch(folder: string, path: string): Promise<string> {
  const git = simpleGit(folder);
  try {
    await git.raw(['ls-files', '--error-unmatch', '--', path]);
    return '';
  } catch {
    // Not tracked, so the patch is the file itself.
  }

  const file = join(folder, path);
  const info = await stat(file);
  if (info.size > DIFF_SIZE_CAP) throw new Error(DIFF_REFUSAL);

  const bytes = await readFile(file);
  if (bytes.includes(0)) throw new Error('This file is not text.');

  const text = bytes.toString('utf8');
  const lines = text === '' ? [] : text.split('\n');
  // A file's final newline ends its last line rather than adding an empty one.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const header = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
  ];
  if (lines.length === 0) return header.join('\n');

  return [...header, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join(
    '\n',
  );
}

/** Put these paths in the index. */
export async function stagePaths(folder: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;

  await onCheckout(folder, () => simpleGit(folder).raw(['add', '--', ...paths]));
}

/**
 * Take these paths back out of the index, keeping what is in the working tree.
 *
 * `git restore --staged` needs a commit to restore from, so a repository with no
 * commits yet falls back to dropping the paths from the index directly.
 */
export async function unstagePaths(folder: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;

  await onCheckout(folder, async () => {
    const git = simpleGit(folder);
    try {
      await git.raw(['restore', '--staged', '--', ...paths]);
    } catch {
      await git.raw(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...paths]);
    }
  });
}

/**
 * Apply one hunk — a file header and a single `@@` block — to the index, or take
 * it back out when `reverse`. Written to a patch file because git reads a patch
 * from a path, and the file is removed whatever git does with it.
 */
export async function applyPatchToIndex(
  folder: string,
  patch: string,
  reverse: boolean,
): Promise<void> {
  await onCheckout(folder, async () => {
    const temporary = join(tmpdir(), `kira-hunk-${randomUUID()}.patch`);
    await writeFile(temporary, patch);

    try {
      await simpleGit(folder).raw([
        'apply',
        '--cached',
        '--recount',
        ...(reverse ? ['--reverse'] : []),
        temporary,
      ]);
    } finally {
      await unlink(temporary);
    }
  });
}

/** Record the index as a commit. */
export async function commitStaged(folder: string, message: string): Promise<void> {
  const subject = message.trim();
  if (subject === '') throw new Error('A commit needs a message.');

  await onCheckout(folder, () => simpleGit(folder).raw(['commit', '-m', subject]));
}

/** Put one path back the way HEAD has it, index and working tree together. */
export async function revertPath(folder: string, path: string): Promise<void> {
  await onCheckout(folder, () =>
    simpleGit(folder).raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', path]),
  );
}

/**
 * Switch the checkout to another branch, refusing a tree with uncommitted
 * tracked changes rather than letting a checkout lose them or leave them behind.
 * Kira does not stash or commit on the person's behalf.
 */
export async function switchBranch(folder: string, branch: string): Promise<void> {
  await onCheckout(folder, async () => {
    const status = await readStatus(folder);
    if (status.staged.length > 0 || status.unstaged.length > 0) {
      throw new Error(
        'There are uncommitted changes. Commit or revert them before switching branch.',
      );
    }

    await simpleGit(folder).raw(['checkout', branch]);
  });
}

/** Recent commits of the current branch, newest first. */
export async function logOf(folder: string, limit: number): Promise<CommitSummary[]> {
  const capped = Math.max(1, Math.min(limit, 200));
  const result = await simpleGit(folder).log({ maxCount: capped });

  return result.all.map((entry) => ({
    hash: entry.hash,
    short: entry.hash.slice(0, 7),
    subject: entry.message,
    author: entry.author_name,
    date: entry.date,
  }));
}

/** The paths one commit changed, named as the status names them. */
export async function commitFilesOf(folder: string, hash: string): Promise<ChangedPath[]> {
  const git = simpleGit(folder);
  const [named, prefix] = await Promise.all([
    git.raw(['show', '--name-status', '--format=', '--no-renames', hash, '--', '.']),
    git.revparse(['--show-prefix']),
  ]);
  const cut = prefix.trim();

  return named
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [status = 'M', ...rest] = line.split('\t');
      return { path: rest.join('\t'), status: status.slice(0, 1) };
    })
    .filter((change) => change.path !== '' && insideOne(change.path, cut) !== null);
}

/**
 * Fetch, pull or push against the checkout's remote, as the person and with no
 * way to prompt: the machine's credentials answer, and a host that refuses is
 * git's own refusal rather than a prompt that hangs the app. A checkout with no
 * remote says so instead.
 */
export async function syncRemote(folder: string, action: GitSyncAction): Promise<string> {
  return onCheckout(folder, async () => {
    const git = simpleGit(folder).env('GIT_TERMINAL_PROMPT', '0');
    const remotes = (await git.raw(['remote'])).trim();
    if (remotes === '') throw new Error('This checkout has no remote to sync with.');

    return await git.raw([action]);
  });
}
