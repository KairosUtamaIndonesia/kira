/**
 * The words the Pull requests view says for what a host reports.
 *
 * The host's own vocabulary is a state and a checks rollup; these turn each into
 * the words a person reads, kept apart from the component so both are checkable
 * without a DOM.
 */

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

/** A pull request's row: its number and title, as one label. */
export function rowLabel(number: number, title: string): string {
  return `#${number} ${title}`;
}
