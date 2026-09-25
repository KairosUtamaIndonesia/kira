import type { ChatSummary } from '../../preload/bridge';

export type ChatSort = 'recent' | 'created' | 'alphabetical';

export const CHAT_SORT_LABELS: Record<ChatSort, string> = {
  recent: 'Recent activity',
  created: 'Created date',
  alphabetical: 'Alphabetical',
};

/** Sort chats without changing the array supplied by the main process. */
export function sortChats(chats: readonly ChatSummary[], sort: ChatSort): ChatSummary[] {
  return [...chats].sort((one, other) => {
    if (sort === 'alphabetical') {
      return one.title.localeCompare(other.title) || recentFirst(one, other);
    }

    if (sort === 'created') {
      return (
        other.createdAt.localeCompare(one.createdAt) ||
        other.updatedAt.localeCompare(one.updatedAt) ||
        one.title.localeCompare(other.title)
      );
    }

    return recentFirst(one, other) || one.title.localeCompare(other.title);
  });
}

function recentFirst(one: ChatSummary, other: ChatSummary): number {
  return other.updatedAt.localeCompare(one.updatedAt);
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Coarsest-unit-first: a chat from last month reads as "last month", not "31 days ago". */
const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['week', 1000 * 60 * 60 * 24 * 7],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
];

/**
 * How long ago `iso` was, read in the sidebar. Two chats can share a title —
 * nothing else in the row tells them apart — so this is what a glance goes on
 * instead.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();

  for (const [unit, ms] of RELATIVE_TIME_UNITS) {
    const value = Math.round(diff / ms);

    if (Math.abs(value) >= 1) {
      return RELATIVE_TIME.format(-value, unit);
    }
  }

  // Under a minute either way rounds to nothing in any unit above — read as
  // "now" rather than "this minute", which is what a bare 0 would say.
  return RELATIVE_TIME.format(0, 'second');
}
