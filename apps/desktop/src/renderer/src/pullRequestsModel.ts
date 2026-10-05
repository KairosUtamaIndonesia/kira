/**
 * The words the Pull requests view says for what a host reports.
 *
 * The host's own vocabulary is a state and a checks rollup; these turn each into
 * the words a person reads, kept apart from the component so both are checkable
 * without a DOM.
 */
import type { LivePullRequest } from '../../preload/bridge.ts';

/** What a pull request's state is called. */
export function stateWord(state: string): string {
  switch (state) {
    case 'open':
      return 'Open';
    case 'draft':
      return 'Draft';
    case 'merged':
      return 'Merged';
    case 'closed':
      return 'Closed';
    default:
      return state;
  }
}

/** What a set of checks came to, or null when the host reported none. */
export function checksWord(state: string | null): string | null {
  switch (state) {
    case 'passed':
      return 'Checks passed';
    case 'failed':
      return 'Checks failed';
    case 'pending':
      return 'Checks running';
    case 'neutral':
      return 'Checks neutral';
    default:
      return null;
  }
}

/**
 * The requests a search leaves, open and draft first.
 *
 * A search matches the number, the title, the author or the branch, all
 * case-insensitively, so `165`, `dummy`, `brandonvalentino` and `agent/dummy-pr`
 * all find the same request. Open and draft requests sort above closed and
 * merged ones; within a group the host's own order — most recently updated
 * first — is kept, which a stable sort gives for free.
 */
export function visibleRequests(
  requests: readonly LivePullRequest[],
  query: string,
): LivePullRequest[] {
  const term = query.trim().toLowerCase();
  const matches =
    term === ''
      ? [...requests]
      : requests.filter(
          (request) =>
            `#${request.number}`.includes(term) ||
            request.title.toLowerCase().includes(term) ||
            (request.authorLogin ?? '').toLowerCase().includes(term) ||
            (request.branch ?? '').toLowerCase().includes(term),
        );

  return matches.sort((one, other) => rank(one) - rank(other));
}

function rank(request: LivePullRequest): number {
  return request.state === 'open' || request.state === 'draft' ? 0 : 1;
}

/**
 * The lines a file's patch adds and removes, or null when the host sent no patch.
 *
 * Only lines after the first hunk header count, so the `---` and `+++` of the
 * file header are never read as a removed and an added line.
 */
export function patchCounts(patch: string | null): { added: number; removed: number } | null {
  if (patch === null) return null;

  const lines = patch.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  if (first === -1) return { added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  for (const line of lines.slice(first)) {
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }

  return { added, removed };
}

/** The one letter a host's word for a changed file is shown as: added, modified, removed, renamed. */
export function fileLetter(status: string): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'modified':
    case 'changed':
      return 'M';
    case 'removed':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    default:
      return status.slice(0, 1).toUpperCase();
  }
}
