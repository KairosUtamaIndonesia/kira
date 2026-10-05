/**
 * One git command at a time per checkout.
 *
 * `git status` refreshes and writes the index, and the workbench runs it on every
 * watcher burst, so an index write that overlaps one of those reads can fail on
 * `index.lock` or be shown half-applied. Every local-git command — status reads
 * included — is queued here, keyed by the folder it runs in, so commands against
 * one checkout are applied one at a time in the order they arrive and never
 * interleave.
 *
 * A command that fails does not wedge the checkout: the chain carries on either
 * way, so one bad patch does not stop the next status read. Keys are dropped
 * once nothing is waiting on them, so a session that touches many folders does
 * not hold a promise for each one forever.
 *
 * Kept apart from the git commands themselves so the ordering is checkable
 * without a checkout: what a queue promises is only observable through what it
 * lets run when.
 */
export type MutationQueue = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export function createMutationQueue(): MutationQueue {
  const tails = new Map<string, Promise<unknown>>();

  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const before = tails.get(key) ?? Promise.resolve();
    const next = before.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );

    tails.set(key, settled);
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });

    return next;
  };
}

/** The queue every local-git command for a checkout shares. */
export const runGitOperation = createMutationQueue();
