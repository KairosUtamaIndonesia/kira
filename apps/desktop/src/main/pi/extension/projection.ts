/**
 * What a summary carries forward.
 *
 * The ledger is a record of everything a chat has told Kira, and it only ever
 * grows as a chat goes on. A summary that quoted all of it would hand the next
 * window a history of the conversation rather than a memory of it — so the
 * ledger is selected from before it is written down, and the selection is the
 * whole of this module.
 *
 * What survives is decided by what a thing is before when it happened: a
 * correction made an hour ago is worth more than a file read five minutes ago,
 * because repeating an approach somebody rejected is the failure this memory
 * exists to prevent, and re-reading a file is not. Only between things that
 * matter equally does the more recent one win.
 *
 * Each thing is named by the turn it was drawn from, so a summary is not a
 * dead end: the words behind it can still be read, and the abbreviation checked
 * against what was actually said.
 */
import { RANK, type HeldObservation, type Observation, type ObservationKind } from './memory.ts';
import type { ReflectionRecord } from '../../db/threads.ts';

/**
 * How many things a summary carries from this chat.
 *
 * Together with the bound on a single line, this is what keeps the sections from
 * crowding out the transcript, and the arithmetic is written out where both
 * numbers are known together — see `ITEM` in `compact.ts`. One number rather than
 * one per section, because what Kira is holding is one body of work and which
 * heading a thing lands under is presentation.
 */
export const CARRIED = 58;

/**
 * How many things it carries from the rest of the workspace.
 *
 * Smaller on purpose. A workspace's chats are other people's afternoons, and what
 * they decided is worth carrying; the same quantity of it as the chat's own, and
 * arriving from chats this one cannot see, would crowd out its memory of its own
 * work.
 */
export const ELSEWHERE = 10;

/**
 * How many of a chat's own conclusions it carries.
 *
 * Conclusions accumulate and are never replaced, so a long chat holds more of them
 * than a summary should quote at once. The newest are carried, because a
 * conclusion is about the work as it now stands and a later one supersedes an
 * earlier one without erasing it: the older ones are still in the ledger and still
 * in the database, and what a summary carries is what the next window needs, not
 * everything the chat has ever worked out.
 */
export const REFLECTED = 10;

/** The ledger as the summary says it: grouped by kind, and named by turn. */
export interface Projection {
  /** What the work is for, oldest first, so a change of plan reads in order. */
  goal: readonly string[];
  changed: readonly string[];
  read: readonly string[];
  commit: readonly string[];
  preference: readonly string[];
  /**
   * What the other chats of this workspace decided.
   *
   * Carried as words alone — see {@link SAID_ELSEWHERE}, which says what each one
   * is. A summary names a turn by its number, and a number only means something
   * within the chat it belongs to, so a fact from another chat is carried as
   * something Kira knows rather than as something she can check.
   */
  elsewhere: readonly string[];
  /**
   * What this chat has worked out, oldest first, so a chain of conclusions reads
   * in the order it was drawn.
   *
   * Named by the turn each was drawn up to rather than by the turn it was drawn
   * on: a conclusion is about a stretch of the chat, and the turn it covers is the
   * one a reader can go back to and check it against.
   */
  reflections: readonly string[];
}

/**
 * What each kind of thing is called when it comes from another chat, and nothing
 * for the kind that does not come at all.
 *
 * A file somebody read is left out. It is the least of what a ledger holds, and
 * the chats of one workspace read a great many files between them: carrying them
 * would fill this with the paths of a sibling's afternoon and bury the decisions
 * it exists to carry. A record rather than a list, so a kind added later has to
 * be placed here before it can be carried.
 */
const SAID_ELSEWHERE: Record<ObservationKind, string | null> = {
  goal: 'Goal',
  changed: 'Changed',
  commit: 'Commit',
  preference: 'Preference',
  read: null,
};

/**
 * The most of `held` a summary can carry, in the order the chat first touched it.
 *
 * The opening goal is kept whatever else has to go: it is the one line a
 * summary cannot do without, and it is the oldest, which is exactly what a
 * recency tie-break would drop first. It is kept *within* `most` rather than on
 * top of it — a bound that quietly admits one more is not the bound it says.
 */
function select<T extends Observation>(held: readonly T[], most: number): T[] {
  const opening = held.find((each) => each.kind === 'goal');
  const ranked = held
    .map((each, index) => ({ each, index }))
    .sort(
      (one, other) =>
        RANK[other.each.relevance] - RANK[one.each.relevance] || other.index - one.index,
    );

  const kept = new Set(
    ranked.slice(0, opening === undefined ? most : most - 1).map(({ each }) => each),
  );
  if (opening !== undefined) kept.add(opening);

  // Filtered from the original rather than returned from the ranking, so the
  // order is the order the chat touched on things and not the order they were
  // judged in.
  return held.filter((each) => kept.has(each));
}

/** One thing, named by the turn it came from when the chat still holds it. */
function named(each: HeldObservation, numberAt: ReadonlyMap<string, number>): string {
  const number = numberAt.get(each.entryId);

  return number === undefined ? each.text : `[${number}] ${each.text}`;
}

/** One conclusion, named by the turn it was drawn up to when there is one. */
function concluded(each: ReflectionRecord): string {
  return each.coversThrough === null ? each.text : `[${each.coversThrough}] ${each.text}`;
}

/** What is carried, grouped the way the summary says it. */
export function projectionIn(
  held: readonly HeldObservation[],
  numberAt: ReadonlyMap<string, number>,
  elsewhere: readonly Observation[] = [],
  reflections: readonly ReflectionRecord[] = [],
): Projection {
  // A file somebody else read is dropped before the selection rather than after
  // it, so that an afternoon of a sibling chat's reading cannot take the room one
  // of its decisions needed.
  const decided = elsewhere.filter((each) => SAID_ELSEWHERE[each.kind] !== null);
  const kept = select(held, CARRIED);
  const lines = (kind: ObservationKind): string[] =>
    kept.filter((each) => each.kind === kind).map((each) => named(each, numberAt));

  return {
    goal: lines('goal'),
    changed: lines('changed'),
    read: lines('read'),
    commit: lines('commit'),
    preference: lines('preference'),
    elsewhere: select(decided, ELSEWHERE).flatMap((each) => {
      const said = SAID_ELSEWHERE[each.kind];

      return said === null ? [] : [`${said}: ${each.text}`];
    }),
    // Chosen from the end and written from the start: which conclusions survive is
    // decided by how recent they are, and the order they are read in is the order
    // they were drawn in.
    reflections: reflections.slice(-REFLECTED).map(concluded),
  };
}
