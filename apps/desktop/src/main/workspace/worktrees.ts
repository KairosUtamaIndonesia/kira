/**
 * Where a run works: a worktree of the project's folder, on the ticket's branch.
 *
 * This is ADR 0012's isolation, and the reason it is a worktree rather than the
 * folder itself: a chat filed under a project works in that project's folder today,
 * and only one of those can be true at a time. Two runs on one project would be two
 * agents in one checkout, each one's edits appearing under the other's feet. A
 * worktree gives each run its own checkout of the same repository, on its own branch,
 * while the folder the person is looking at stays exactly where it was.
 *
 * The branch belongs to the ticket rather than to the run: a run that ends leaves it
 * behind, so a second try at the same ticket carries on from what the first one did
 * instead of starting again from the same commit.
 *
 * git is run through the same `simple-git` the workbench lists folders with — a way
 * of running the binary rather than a second git (docs/adr/0014).
 */
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

/** Making and unmaking the checkout a run works in. */
export type SpecMerge =
  | { kind: 'merged' }
  | { kind: 'conflict'; reason: string }
  | { kind: 'refused'; reason: string };

export interface Worktrees {
  /**
   * Make sure a spec branch exists locally and on origin, answering null when the
   * configured remote cannot be reached or pushed to. This is a preflight: callers
   * run it before claiming a ticket.
   */
  prepareSpec(folder: string, branch: string): Promise<string | null>;
  /** Merge a slice branch into the pushed spec branch, answering without touching either on failure. */
  mergeSpec(folder: string, specBranch: string, runBranch: string): Promise<SpecMerge>;
  /**
   * A worktree of `folder` on `branch`, at `into`. When `from` is given, a new
   * ticket branch starts at that branch rather than at the folder's current HEAD.
   */
  make(folder: string, branch: string, into: string, from?: string): Promise<string | null>;
  /** Take a worktree away, leaving its branch behind, however the run ended. */
  drop(folder: string, into: string): Promise<void>;
  /**
   * What a run changed in its checkout, as one line: how many files, and how much.
   *
   * Measured against the commit `folder` is on — where the branch was cut from, since
   * nobody else works in that folder while a run is going — so it counts what the run
   * committed *and* what it left uncommitted, which together are what it did. Answers
   * null when there is nothing to compare.
   */
  changed(folder: string, into: string): Promise<string | null>;
}

export function runWorktrees(): Worktrees {
  return {
    async prepareSpec(folder, branch) {
      try {
        const git = simpleGit(folder);
        await git.raw(['ls-remote', 'origin']);

        const made = await branches(git);
        const onRemote = await remoteBranch(git, branch);
        if (onRemote) {
          // The spec branch is shared by every slice. Refresh the local ref before making
          // a checkout so the next slice starts at the work accepted by another run too.
          await git.raw(['fetch', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
          await git.raw(['branch', '--force', branch, `refs/remotes/origin/${branch}`]);
        } else if (!made.includes(branch)) {
          await git.raw(['branch', branch, await defaultBranch(git)]);
        }

        if (!onRemote) {
          await git.push(['--set-upstream', 'origin', branch]);
        } else {
          // A dry run checks authentication and the remote's receive permissions without
          // changing it. The real push happens only after a slice has been merged.
          await git.push(['--dry-run', 'origin', `${branch}:refs/heads/${branch}`]);
        }

        return branch;
      } catch {
        return null;
      }
    },

    async mergeSpec(folder, specBranch, runBranch) {
      const git = simpleGit(folder);
      let into: string | null = null;

      try {
        // Merge in a detached temporary worktree. The person's checkout and the local spec
        // ref remain untouched until the remote accepts the complete result.
        into = await mkdtemp(join(tmpdir(), 'foundry-spec-merge-'));
        await git.raw(['worktree', 'add', '--detach', into, specBranch]);
        const merge = simpleGit(into);

        try {
          await merge.merge([runBranch]);
        } catch (error) {
          const files = await merge.raw(['diff', '--name-only', '--diff-filter=U']).catch(() => '');
          await merge.raw(['merge', '--abort']).catch(() => {});
          const listed = files.trim().replaceAll('\n', ', ');
          return {
            kind: 'conflict',
            reason: listed === '' ? String(error) : `conflicting files: ${listed}`,
          };
        }

        const merged = (await merge.revparse(['HEAD'])).trim();
        try {
          await merge.push(['origin', `HEAD:refs/heads/${specBranch}`]);
        } catch (error) {
          return { kind: 'refused', reason: String(error) };
        }

        await git.raw(['update-ref', `refs/heads/${specBranch}`, merged]);
        return { kind: 'merged' };
      } catch (error) {
        return { kind: 'refused', reason: String(error) };
      } finally {
        if (into !== null) {
          await git.raw(['worktree', 'remove', '--force', into]).catch(() => {});
          await git.raw(['worktree', 'prune']).catch(() => {});
          await rm(into, { recursive: true, force: true }).catch(() => {});
        }
      }
    },

    async make(folder, branch, into, from) {
      try {
        await mkdir(dirname(into), { recursive: true });
        const git = simpleGit(folder);

        // Anything already at that path is a run that did not get to clean up after
        // itself — this machine was closed, or killed. Its work is on the branch it
        // worked on, so the checkout itself is only in the way.
        await dropAt(git, into);

        const made = await branches(git);
        await git.raw(
          made.includes(branch)
            ? ['worktree', 'add', into, branch]
            : ['worktree', 'add', '-b', branch, into, ...(from === undefined ? [] : [from])],
        );

        return into;
      } catch {
        return null;
      }
    },

    async drop(folder, into) {
      try {
        await dropAt(simpleGit(folder), into);
      } catch {
        // A worktree that cannot be taken away is not a failure worth reporting: what
        // it held is on its branch, and the next run on this ticket clears the path.
      }
    },

    async changed(folder, into) {
      try {
        const from = (await simpleGit(folder).revparse(['HEAD'])).trim();
        const stat = await simpleGit(into).raw(['diff', '--stat', from]);
        const last = stat
          .split('\n')
          .map((each) => each.trim())
          .filter((each) => each !== '')
          .at(-1);

        return last === undefined ? null : last;
      } catch {
        return null;
      }
    },
  };
}

/** The branches this checkout knows, without their markers. */
async function branches(git: ReturnType<typeof simpleGit>): Promise<string[]> {
  const listed = await git.raw(['branch', '--list', '--format=%(refname:short)']);

  return listed
    .split('\n')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

/** Whether origin has the named branch. */
async function remoteBranch(git: ReturnType<typeof simpleGit>, branch: string): Promise<boolean> {
  const listed = await git.raw(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);

  return listed.trim() !== '';
}

/** The project's default branch, preferring origin's advertised HEAD. */
async function defaultBranch(git: ReturnType<typeof simpleGit>): Promise<string> {
  const advertised = await git.raw(['ls-remote', '--symref', 'origin', 'HEAD']);
  const remote = /^ref: refs\/heads\/(.+)\s+HEAD$/m.exec(advertised)?.[1];
  const local = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

  // A desktop may be on a feature branch and may not have fetched the default branch,
  // so use origin's advertised HEAD rather than whichever branch happens to be checked
  // out. Fetching only that ref keeps the preflight from changing any worktree.
  if (remote !== undefined) {
    await git
      .raw(['fetch', 'origin', `refs/heads/${remote}:refs/remotes/origin/${remote}`])
      .catch(() => {});
  }

  for (const candidate of [remote === undefined ? undefined : `origin/${remote}`, remote, local]) {
    if (candidate === undefined || candidate === 'HEAD') continue;

    try {
      await git.raw(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // The remote may advertise a branch that this checkout has not fetched.
    }
  }

  throw new Error('The project has no default branch to start the spec branch from.');
}

/**
 * Clear whatever is registered at a path, if anything is.
 *
 * `--force` because the worktree a crashed run left behind has uncommitted changes by
 * definition, and refusing to remove it would leave that path unusable for every later
 * run on the same ticket. The branch is untouched, which is the whole reason this is
 * safe: nothing that was committed is lost.
 */
async function dropAt(git: ReturnType<typeof simpleGit>, into: string): Promise<void> {
  await git.raw(['worktree', 'remove', '--force', into]).catch(() => {});
  await git.raw(['worktree', 'prune']).catch(() => {});
}
