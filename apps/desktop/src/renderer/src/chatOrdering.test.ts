import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatSummary } from '../../preload/bridge.ts';
import { type ChatSort, relativeTime, sortChats } from './chatOrdering.ts';

/**
 * The order the chat list is drawn in, which is a choice rather than a fact: a
 * chat's title, when it was made and when it was last spoken in are three
 * different things to sort by, and ties have to break the same way twice so the
 * list does not shuffle itself between reloads.
 */
interface Case {
  name: string;
  makeChats: () => ChatSummary[];
  sort: ChatSort;
  want: string[];
}

/** A chat as the list receives it, filed nowhere: only the order matters here. */
function chat(id: string, title: string, createdAt: string, updatedAt: string): ChatSummary {
  return { id, title, createdAt, updatedAt, workspaceId: null, ticketId: null };
}

/** A day in January, in the shape pi writes timestamps: UTC, to the millisecond. */
function at(day: number): string {
  return `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
}

/** Three chats, deliberately in no mode's order, whose each is the last by one. */
function threeChats(): ChatSummary[] {
  return [
    chat('zebra', 'Zebra', at(5), at(5)),
    chat('alpha', 'Alpha', at(1), at(9)),
    chat('mid', 'Mid', at(3), at(7)),
  ];
}

const CASES: Case[] = [
  {
    name: 'recent activity: the one last spoken in comes first',
    makeChats: threeChats,
    sort: 'recent',
    want: ['alpha', 'mid', 'zebra'],
  },
  {
    name: 'created date: the one made last comes first',
    makeChats: threeChats,
    sort: 'created',
    want: ['zebra', 'mid', 'alpha'],
  },
  {
    name: 'alphabetical: the titles read in order',
    makeChats: threeChats,
    sort: 'alphabetical',
    want: ['alpha', 'mid', 'zebra'],
  },
  {
    name: 'two chats touched at the same moment fall back to their titles',
    makeChats: () => [chat('b', 'Beta', at(1), at(9)), chat('a', 'Alpha', at(1), at(9))],
    sort: 'recent',
    want: ['a', 'b'],
  },
  {
    name: 'two chats made at the same moment fall back to the one spoken in last',
    makeChats: () => [chat('quiet', 'Quiet', at(1), at(2)), chat('busy', 'Busy', at(1), at(8))],
    sort: 'created',
    want: ['busy', 'quiet'],
  },
  {
    name: 'two chats made at the same moment and both quiet fall back to titles',
    makeChats: () => [chat('b', 'Beta', at(1), at(2)), chat('a', 'Alpha', at(1), at(2))],
    sort: 'created',
    want: ['a', 'b'],
  },
  {
    name: 'chats sharing a title fall back to the one spoken in last',
    makeChats: () => [
      chat('same-old', 'Same', at(1), at(2)),
      chat('same-new', 'Same', at(1), at(8)),
    ],
    sort: 'alphabetical',
    want: ['same-new', 'same-old'],
  },
  {
    name: 'a list with nothing in it stays empty',
    makeChats: () => [],
    sort: 'recent',
    want: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    const chats = testCase.makeChats();
    const given = chats.map((chat) => chat.id);

    assert.deepEqual(
      sortChats(chats, testCase.sort).map((chat) => chat.id),
      testCase.want,
    );

    // The list the main process supplied is ordered by reading it, not by
    // rearranging it: the sidebar holds it in state, and reordering in place
    // would leave the runtime holding an order the user never chose.
    assert.deepEqual(
      chats.map((chat) => chat.id),
      given,
      'the list it was given was reordered',
    );
  });
}

/**
 * What tells two same-titled chat rows apart: how long ago each was last
 * spoken in, read in the coarsest unit that still means something.
 */
interface RelativeCase {
  name: string;
  iso: string;
  now: string;
  want: string;
}

const RELATIVE_CASES: RelativeCase[] = [
  {
    name: 'a moment ago reads as now',
    iso: at(1),
    now: '2026-01-01T00:00:10.000Z',
    want: 'now',
  },
  {
    name: 'minutes ago',
    iso: at(1),
    now: '2026-01-01T00:20:00.000Z',
    want: '20 minutes ago',
  },
  {
    name: 'hours ago',
    iso: at(1),
    now: '2026-01-01T05:00:00.000Z',
    want: '5 hours ago',
  },
  {
    name: 'yesterday reads as a day rather than 24 hours',
    iso: at(1),
    now: at(2),
    want: 'yesterday',
  },
  {
    name: 'a week ago',
    iso: at(1),
    now: at(8),
    want: 'last week',
  },
];

for (const testCase of RELATIVE_CASES) {
  test(`relativeTime: ${testCase.name}`, () => {
    assert.equal(relativeTime(testCase.iso, new Date(testCase.now).getTime()), testCase.want);
  });
}
