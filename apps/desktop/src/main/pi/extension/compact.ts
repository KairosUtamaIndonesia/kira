/**
 * What Kira carries forward when a chat is compacted.
 *
 * A pure function: turns in, a summary out. Nothing here reads pi, the database
 * or the clock, and the same turns therefore always produce the same summary —
 * which is what lets a person reason about what Kira knows, and what a prose
 * summary cannot promise.
 *
 * The summary has five parts. The goal of the work, the files it touched, the
 * commits it made and what the person asked for are read from *every* turn of
 * the chat; only the transcript is read from the window this compaction is about
 * to discard. That split is the whole design. pi hands the hook the branch it is
 * compacting as well as the window, so the four sections are recomputed from the
 * conversation itself rather than from the last summary — which means a chat's
 * fifth compaction knows exactly as much as its first, and nothing is lost by
 * being summarised twice.
 *
 * Those four sections are the ledger — what Kira is holding — selected and
 * written down, rather than a second reading of the same turns. Two things come
 * of that. The sections carry every change of plan rather than only the latest,
 * because a plan abandoned three hours ago is still something Kira was told and
 * a summary that forgot it would send her back to work somebody stopped. And
 * every line names the turn it came from, so nothing in the summary is a dead
 * end: the words behind an abbreviation can still be read.
 *
 * An earlier version of this carried the previous summary forward as text and
 * pasted it into the new one. It worked, and it was worse: a summary that quoted
 * a summary needed its headings stripped back out on every generation, and what
 * Kira knew decayed a little each time regardless. Recomputing has neither
 * problem, and the previous summary is now not read at all.
 *
 * The summary also names the one thing the chat needs in order to say *where* it
 * was cut — see {@link lastWords}, which is stored beside the summary rather than
 * in it.
 */
import type { ReflectionRecord } from '../../db/threads.ts';
import { numberedIn, type StoredTurn } from './entries.ts';
import { observationsIn, type Observation } from './memory.ts';
import { projectionIn } from './projection.ts';
import type { Turn } from './turn.ts';

/**
 * What a compaction writes down beside its summary.
 *
 * Beside it rather than in it because this is not part of what the model reads:
 * pi keeps `details` on the entry and puts only the summary in front of the
 * model. It is the one place a compaction entry holds Kira's own vocabulary.
 */
export interface CompactionDetails {
  /**
   * The last thing the person asked before the cut, or null when the discarded
   * turns held nothing they asked. What a boundary leads with — see
   * {@link lastWords}.
   */
  lastWords: string | null;
}

/** Everything the reconstruction reads. */
export interface CompactionInput {
  /**
   * Every turn of the chat, with the entry each is stored as — the whole branch
   * being compacted, and not only the part of it going away. What the sections
   * are read from, and where the turn numbers they name come from.
   */
  branch: readonly StoredTurn[];
  /** The turns this compaction discards, which is what the transcript covers. */
  discarded: readonly Turn[];
  /** The folder the chat works in, for naming files by where they are. */
  cwd?: string;
  /**
   * What the other chats of this workspace decided, when the chat is filed under
   * one. Read from the database by the caller rather than from `branch`, which
   * is why it arrives separately: these are not turns of this chat, and there is
   * nothing in it to check them against.
   */
  elsewhere?: readonly Observation[];
  /**
   * What this chat has worked out, from its own ledger.
   *
   * Passed in rather than read here, because a reflection is drawn by a model and
   * this function draws nothing: it is given what the reflector concluded and
   * writes it into the summary.
   */
  reflections?: readonly ReflectionRecord[];
}

/**
 * How much of the summary the model reads, in the units {@link cost} counts —
 * about six thousand tokens. Not a number that grows with the chat.
 */
export const BUDGET = 24_000;

/** CJK ideographs, including the extension A and compatibility ranges. */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/**
 * What one character costs, in the units the budget counts.
 *
 * Latin text runs about four characters to a token and CJK about one, so a budget
 * counted in characters would be four times the size it says it is on exactly the
 * chats this handling was ported to keep — and a budget that is silently four
 * times what it claims is not a budget. Four units for a CJK character and one
 * for any other is what lets a single number bound both.
 */
const priceOf = (character: string): number => (CJK.test(character) ? 4 : 1);

/** What a piece of the summary costs, in the units {@link BUDGET} counts. */
function cost(text: string): number {
  let spent = 0;

  for (let at = 0; at < text.length; at += 1) spent += priceOf(text[at] ?? '');

  return spent;
}

/**
 * How much of one turn is a line before it is cut short, in the same units.
 *
 * Separate from the budget because it protects against a different thing: a
 * single pasted file is one turn, and without this it would spend the whole
 * summary on itself and leave the conversation out.
 */
const LINE = 500;

/**
 * How long one thing in a section may be — a path, a commit, a goal, a line of
 * what was asked for.
 *
 * The bound that makes {@link BUDGET} true rather than usually true, together
 * with the three counts that decide how many things there are: the projection's
 * `CARRIED` for this chat, `ELSEWHERE` for its workspace and `REFLECTED` for what it
 * has worked out — see `projection.ts`. Those come to `(58 + 10 + 10) × 200`
 * units, and with the headings, the blank lines and the note at the end that is
 * under two thirds of the budget whatever the chat contains — so the transcript
 * always has more than eight thousand units to be written in, and can never be
 * squeezed out by the sections above it. Only
 * reachable at all for the files and the commits, whose length is whatever a tool
 * printed.
 */
const ITEM = 200;

/**
 * What a cut reports at most — ` […123456789 more characters]`.
 *
 * Held back out of the limit rather than added after it. {@link clip} is what
 * makes an item cost {@link ITEM} rather than a little more than it, and a bound
 * with a hole in it the size of its own suffix is not a bound: fifty-eight lines
 * each overshooting by thirty is more than a whole extra item. No string is long
 * enough for the count to need more digits than this leaves.
 */
const CUT = 32;

/**
 * The summary of a chat, as it stands at this compaction.
 *
 * The four sections first, because they are what survives being summarised
 * repeatedly, and the transcript last, because it is what the sections are a
 * précis of. A section with nothing to say is left out rather than written as
 * empty — a chat with no commits should not carry a heading saying so.
 */
export function reconstruct({
  branch,
  discarded,
  cwd,
  elsewhere = [],
  reflections = [],
}: CompactionInput): string {
  const carried = projectionIn(
    observationsIn(branch, cwd),
    new Map(numberedIn(branch).map((each) => [each.entryId, each.number])),
    elsewhere,
    reflections,
  );
  const parts: string[] = [];

  // First, because a conclusion is the most a summary can carry: everything under
  // it is evidence for something, and this is what the evidence amounted to.
  add(parts, 'Reflections', carried.reflections);
  add(parts, 'Goal', carried.goal);
  add(parts, 'Files and changes', [
    ...carried.changed.map((path) => `Changed: ${path}`),
    ...carried.read.map((path) => `Read: ${path}`),
  ]);
  add(parts, 'Commits', carried.commit);
  add(parts, 'Preferences', carried.preference);
  add(parts, 'Decided in this workspace', carried.elsewhere);

  // Read before the transcript goes on, because the note at the end explains the
  // numbers in these sections and not the conversation below them — and is only
  // written when there are numbers to explain, which is not the same as there
  // being sections: a summary whose only lines came from another chat's ledger
  // holds no turn it could be asked about.
  const named = [
    carried.reflections,
    carried.goal,
    carried.changed,
    carried.read,
    carried.commit,
    carried.preference,
  ].some((lines) => lines.some((line) => line.startsWith('[')));

  // Everything that is not the transcript: the sections, the note, and the
  // heading the transcript is written under, counted together with the blank
  // lines between them. A budget that forgot its own headings would be over by
  // exactly as much as they cost, which is how this came to be written out.
  const fixed =
    cost(parts.join('\n\n')) + (named ? cost(HOW_TO_LOOK) + 2 : 0) + cost(TRANSCRIPT) + 2;

  // What is left of the budget goes to the transcript, so the summary as a whole
  // is bounded even though the sections above are not what bounds it.
  const transcript = transcriptOf(discarded, BUDGET - fixed);
  if (transcript !== '') parts.push(`${TRANSCRIPT}${transcript}`);
  if (named) parts.push(HOW_TO_LOOK);

  return parts.join('\n\n');
}

/** What the transcript is written under when there is one. */
const TRANSCRIPT = '## Transcript\n\n';

/**
 * The line that says what the numbers in the sections are for.
 *
 * The details a summary leaves out are exactly the ones worth going back for, so
 * a summary that reads as the whole of what is known is worse than one that says
 * where to look.
 */
const HOW_TO_LOOK =
  'A number in brackets names a turn of this chat: `recall` reads one back, or reads a file as the turn that touched it saw it.';

/** A section, left out entirely when it has nothing to say. */
function add(parts: string[], heading: string, lines: readonly string[]): void {
  if (lines.length === 0) return;

  parts.push(`## ${heading}\n\n${lines.map((line) => `- ${clip(line, ITEM)}`).join('\n')}`);
}

/**
 * What was said, newest last, up to what is left of the budget.
 *
 * Read backwards and reversed so that running out of room drops the oldest
 * turns: the sections above already account for what those turns amounted to,
 * and the recent ones are what the next reply depends on. A turn is only
 * dropped wholesale — half a turn in the transcript would read as the whole of
 * one, which is why the line above bounds a single turn instead.
 */
function transcriptOf(turns: readonly Turn[], room: number): string {
  const said: string[] = [];
  let used = 0;

  for (const turn of [...turns].reverse()) {
    const text = turn.text.trim();
    if (text === '') continue;

    const line = `**${turn.speaker}:** ${clip(text)}`;
    const spent = cost(line) + 2;
    if (used + spent > room) break;

    said.push(line);
    used += spent;
  }

  return said.reverse().join('\n\n');
}

/**
 * How much of `text` fits in `limit` units, as a character count.
 *
 * The walk behind {@link clip}, shared with recall's paging: a page has to end
 * where the budget ends rather than a fixed number of characters in, or a file
 * written in CJK would take four times the room it was given.
 */
export function fitIn(text: string, limit: number): number {
  let spent = 0;
  let at = 0;

  while (at < text.length && spent < limit) {
    spent += priceOf(text[at] ?? '');
    at += 1;
  }

  return at;
}

/**
 * A piece of text, cut short when it costs more than it is allowed.
 *
 * Counted in units rather than characters, so that a path or a commit written in
 * CJK does not quietly take four times its share of the budget. Shared with
 * recall, which has the same problem for the same reason: what it quotes back is
 * going in front of a model, and a turn can be a pasted file.
 */
export function clip(text: string, limit = LINE): string {
  const at = fitIn(text, Math.max(limit - CUT, 0));
  if (at >= text.length) return text;

  return `${text.slice(0, at).trimEnd()} […${text.length - at} more characters]`;
}

/**
 * What a boundary leads with: the last thing the person asked before the cut.
 *
 * The last thing they said and not the last turn, because the last turn is
 * usually Kira's answer — a marker leading with that would say what she
 * concluded rather than where the discarded part of the chat ends.
 *
 * Read from the turns rather than from the summary's own text. By the time the
 * window holds a summary the turns are gone, and the only way back to a sentence
 * would be to parse the prose this module wrote and hope the shape still held. It
 * is stored beside the summary as the compaction's `details`, which pi keeps and
 * never sends to the model.
 *
 * Null when the discarded turns hold nothing the person asked — a stretch of
 * tool calls, or a cut falling inside Kira's reply. The boundary has a count to
 * give and no words to quote, which is a thing it can say.
 */
export function lastWords(turns: readonly Turn[]): string | null {
  const asked = turns.filter((turn) => turn.speaker === 'person' && turn.text.trim() !== '');
  const last = asked.at(-1);

  return last === undefined ? null : last.text.trim();
}
