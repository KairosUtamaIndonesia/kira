/**
 * What Kira is holding.
 *
 * The reconstruction's extractors, run as a chat happens rather than when it is
 * compacted: the goal of the work, the files it touched, the commits it made and
 * what the person asked for, each recorded once with the entry it came from.
 * Nothing here calls a model, and nothing here reads the clock — an observation
 * carries the moment of the turn it was drawn from, which is both truer than the
 * moment it was noticed and the same every time the chat is read again.
 *
 * Pure, like the reconstruction it shares its extractors with, so the same chat
 * always yields the same observations. That is what lets the observer run on
 * every settled turn and re-run over a chat it has already seen: holding
 * something twice is not possible, so the second pass has nothing to add.
 *
 * It is not a summary. A summary is this, selected and written down — see
 * `projection.ts` — and the two differ in what a reader is meant to do with
 * them: the ledger remembers, so that a plan abandoned two turns ago is still
 * something Kira was told, and the summary reports where the work stands.
 */
import { commitsIn, filesIn, goalIn, preferencesIn } from './extract.ts';
import type { StoredTurn } from './entries.ts';
import type { ObservationRecord } from '../../db/threads.ts';
import type { Turn } from './turn.ts';

/** What an observation is about. */
export type ObservationKind = 'goal' | 'changed' | 'read' | 'commit' | 'preference';

/**
 * How much it matters.
 *
 * Derived from the kind rather than guessed at, because the observer is
 * deterministic and has nothing to guess with. A correction outranks everything:
 * repeating an approach the person rejected is the failure this memory exists to
 * prevent. A file Kira changed outranks one she read, and both are below anything
 * the person asked for.
 */
export type Relevance = 'critical' | 'high' | 'medium' | 'low';

const RELEVANCE: Record<ObservationKind, Relevance> = {
  preference: 'critical',
  goal: 'high',
  changed: 'medium',
  commit: 'medium',
  read: 'low',
};

const RANK: Record<Relevance, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * What each kind of thing matters, for anything that has to choose between them.
 *
 * Exported because the summary has to make the same judgement the ledger does
 * when it decides what it can carry and what it has to leave behind.
 */
export { RANK };

/** One thing Kira is holding, and where she got it. */
export interface Observation {
  /**
   * The entry this was drawn from, so that what Kira is holding can be checked
   * against what was actually said rather than taken on trust.
   *
   * Null when there is nothing left to check it against: a workspace keeps what a
   * chat worked out once the chat is gone, and the entry went with the chat.
   */
  entryId: string | null;
  at: string;
  kind: ObservationKind;
  relevance: Relevance;
  text: string;
}

/**
 * One thing a chat's own ledger holds, which always names the turn behind it.
 *
 * The observer walks the branch, so everything it works out came from a turn of
 * this chat. Only what a workspace kept from a chat that is gone can have none —
 * which is why the read from the database is the wide type and this is not.
 */
export interface HeldObservation extends Observation {
  entryId: string;
}

/**
 * Everything a chat has told Kira, in the order it was first said.
 *
 * The branch is walked once rather than each turn in isolation, because not every
 * extractor can read a turn on its own: whether a message opens the work or
 * changes it depends on what was asked before it, so the goal extractor is given
 * the person's turns as they accumulate and the walk keeps whatever is new —
 * which is, by construction, whatever this turn brought.
 *
 * `cwd` is the folder the chat works in, and it is here for the same reason the
 * reconstruction takes it: a file is named by where it is in the work, not by
 * where it is on the disk. Both readings of a chat have to agree about that, or
 * the ledger and the summary would name the same file two ways.
 */
export function observationsIn(branch: readonly StoredTurn[], cwd?: string): HeldObservation[] {
  const held = new Map<string, HeldObservation>();
  const asked: Turn[] = [];

  const keep = (kind: ObservationKind, text: string, where: StoredTurn): void => {
    const already = held.get(text);
    const relevance = RELEVANCE[kind];

    // The more specific reading of a thing wins. A file she went on to change is
    // not also one she only read, and a line that turns out to be a standing
    // instruction is not also part of the goal. The winner takes the place of
    // what it replaces, so the order stays the order the chat first touched on
    // things rather than the order the kinds happened to be read in.
    if (already !== undefined && RANK[already.relevance] >= RANK[relevance]) return;

    held.set(text, { entryId: where.entryId, at: where.at, kind, relevance, text });
  };

  for (const where of branch) {
    const { turn } = where;

    if (turn.speaker === 'person') {
      asked.push(turn);

      for (const goal of goalIn(asked)) {
        keep('goal', goal, where);
      }

      for (const preference of preferencesIn([turn])) {
        keep('preference', preference, where);
      }
    }

    const files = filesIn([turn], cwd);

    for (const path of files.changed) {
      keep('changed', path, where);
    }

    for (const path of files.read) {
      keep('read', path, where);
    }

    for (const commit of commitsIn([turn])) {
      keep('commit', commit, where);
    }
  }

  return [...held.values()];
}

/** Whether a word is one this build has a meaning for. */
function knows<T extends string>(word: string, vocabulary: Record<T, unknown>): word is T {
  return word in vocabulary;
}

/**
 * What a chat is holding, read back from what was written down.
 *
 * A row whose kind or level this build has never heard of is left out rather than
 * trusted. The table keeps both as text and checks neither, deliberately, so the
 * only way such a row can arrive is a newer build having written the ledger this
 * one is reading. A fact read as the wrong kind of fact is worse than one not
 * read, and a level nothing can rank cannot be ranked.
 *
 * Both words are checked here and not in the panel that reads the same rows,
 * because the two readers want different things: a panel groups by kind and does
 * not care what a thing is worth, and the summary ranks by both.
 */
export function observationsOf(rows: readonly ObservationRecord[]): Observation[] {
  const known: Observation[] = [];

  for (const row of rows) {
    if (!knows(row.kind, RELEVANCE) || !knows(row.relevance, RANK)) continue;

    known.push({
      entryId: row.entryId,
      at: row.at,
      kind: row.kind,
      relevance: row.relevance,
      text: row.text,
    });
  }

  return known;
}
