/**
 * Looking things up in a chat's own history.
 *
 * The half of recall that works out an answer, kept pure: turns in, an answer
 * out, with no session, no database and no clock. What reaches pi — the tool, its
 * schema and the query it runs — is the other half, and it is the only part that
 * knows any of this exists.
 *
 * A number is the point of the whole thing. Kira is handed a chat whose earlier
 * turns a compaction took away, so text she remembers is text she cannot quote;
 * a number she can, and it goes on meaning the same turn because it counts turns
 * in the order they were said rather than a position in a list that keeps
 * changing. Compaction adds an entry of its own, which carries no turn, so no
 * number moves when it happens.
 */
import { clip, fitIn } from './compact.ts';
import type { NumberedTurn } from './entries.ts';
import type { Part, PartKind, Speaker } from './turn.ts';

/**
 * How many turns one search may bring back.
 *
 * Recall exists to protect the context it is used in: a search whose words are
 * common is a search that matches the whole chat, and handing all of it back
 * would spend the room it was meant to save. The cap is on turns rather than
 * characters because a turn is what has a number, and so what can be asked for
 * again one at a time.
 */
export const FOUND = 20;

/**
 * The turn `number` stands for, or nothing when this chat has no such turn.
 *
 * Nothing rather than the nearest turn: a wrong turn reads exactly like a right
 * one, so an answer built on one would be believed.
 */
export function turnAt(turns: readonly NumberedTurn[], number: number): NumberedTurn | null {
  if (!Number.isInteger(number) || number < 1 || number > turns.length) return null;

  return turns[number - 1] ?? null;
}

/** A turn a search found. */
export interface Found extends NumberedTurn {
  /** Where in the turn the words were, which is what makes the match readable. */
  speaker: Speaker;
}

/**
 * The turns whose words hold `words`, in the order they were said, up to `cap`.
 *
 * Case-insensitive, and matched anywhere in the turn rather than at a word
 * boundary: what Kira has to search with is a fragment she remembers, and `roll`
 * should find `docs/rollback.md`.
 *
 * A search for nothing finds nothing. Every turn holds the empty string, so
 * answering it honestly would be to hand back the whole chat — which is both
 * useless and the exact failure this tool exists to prevent.
 */
export function searchIn(
  turns: readonly NumberedTurn[],
  words: string,
  cap: number = FOUND,
): Found[] {
  return searchAcross([{ name: null, turns }], words, cap);
}

/** One chat a workspace-scoped search reaches into. */
export interface Chat {
  /**
   * What the chat is called, or null for the chat being asked. A hit's number
   * is a handle that can be read back only where the reader already is, which is
   * why the chat being asked is the one that goes without a name.
   */
  name: string | null;
  turns: readonly NumberedTurn[];
}

/** A turn a workspace-scoped search found, and the chat it was said in. */
export interface FoundAcross extends Found {
  /** The chat it came from, or null when it came from the chat being asked. */
  from: string | null;
}

/**
 * The turns of every chat given whose words hold `words`, taking the chats in
 * the order they are given and each one's turns in its own order.
 *
 * One `cap` covers the whole search rather than each chat, because what has to
 * stay bounded is the answer. A cap per chat would let a workspace of twenty
 * chats return four hundred turns, which is the flood this tool exists to
 * prevent — and it would arrive exactly when a question was too broad to answer.
 */
export function searchAcross(
  chats: readonly Chat[],
  words: string,
  cap: number = FOUND,
): FoundAcross[] {
  const wanted = words.trim().toLowerCase();
  if (wanted === '') return [];

  const found: FoundAcross[] = [];

  for (const chat of chats) {
    if (found.length >= cap) break;

    for (const turn of chat.turns) {
      if (found.length >= cap) break;
      if (!turn.turn.text.toLowerCase().includes(wanted)) continue;

      found.push({ ...turn, speaker: turn.turn.speaker, from: chat.name });
    }
  }

  return found;
}

// ── Reading a turn again ─────────────────────────────────────────────────────

/** A piece of a long piece of text, and which piece of how many it is. */
export interface Page {
  text: string;
  page: number;
  pages: number;
}

/**
 * One page of a long piece of text.
 *
 * A page is as much as a quoted turn, counted in the same units, and the pages are
 * worked out from the whole text so that an answer can say how many there are — a
 * file with more in it than one page is a fact the reader needs, or the end of the
 * page reads as the end of the file.
 *
 * Nothing rather than the nearest page: a page of a file that is not the one that
 * was asked for reads exactly like one that is, and nobody reading it can tell.
 */
export function paged(text: string, asked = 1): Page | null {
  const ends: number[] = [];
  let at = 0;

  while (at < text.length) {
    at += fitIn(text.slice(at), QUOTED);
    ends.push(at);
  }

  // A tool that handed nothing back still happened, and its one page is empty.
  if (ends.length === 0) ends.push(0);
  if (!Number.isInteger(asked) || asked < 1 || asked > ends.length) return null;

  const from = asked === 1 ? 0 : (ends[asked - 2] ?? 0);

  return {
    text: text.slice(from, ends[asked - 1] ?? text.length),
    page: asked,
    pages: ends.length,
  };
}

/** A path as it was written in a tool call, with what is not the file taken off. */
export function cleanedPath(path: string): string {
  return path
    .trim()
    .replace(/^["'`<([]+/, '')
    .replace(/["'`>\])]+$/, '')
    .replace(/#L\d+$/, '')
    .replace(/:\d+(-\d+)?$/, '')
    .replace(/^\.\//, '');
}

/**
 * Whether two writings of a path are the same file.
 *
 * Equal once the line number, the quoting and a leading `./` are off, or one is
 * the other written from the top of the tree — which is how a tool call recorded
 * as `src/a.ts` is found by someone asking for `/repo/src/a.ts`. Anchored at a
 * path separator, so `beta.ts` is not read as a request for `a.ts`.
 */
export function samePath(one: string, other: string): boolean {
  const a = cleanedPath(one);
  const b = cleanedPath(other);

  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

// ── Saying what was found ────────────────────────────────────────────────────

/** How much of one turn is quoted back in full. */
export const QUOTED = 2_000;

/** How much of a turn a search result shows. */
const SNIPPET = 200;

/** The word for each speaker, as a reader of the answer would use it. */
const NAMED: Record<Speaker, string> = { person: 'you', kira: 'kira', tool: 'a tool' };

/**
 * One turn, quoted.
 *
 * Bounded, because a turn is whatever was said on it — including a file someone
 * pasted in. Recall is used to save room in front of a model, so a lookup that
 * spent all of it would have cost more than it recovered.
 */
export function renderTurn(turn: NumberedTurn): string {
  return `#${turn.number} (${NAMED[turn.turn.speaker]}, ${turn.at}):\n${clip(turn.turn.text, QUOTED)}`;
}

/**
 * What a search found, or that the chat does not say it.
 *
 * A full page is said to be a full page. The cap is a real limit, and an answer
 * that just stopped at twenty would read exactly like a chat that only had twenty
 * — which is the difference between "that is all there is" and "ask me again
 * differently", and a model cannot tell them apart unless it is told.
 */
/** The word for each kind, as a reader of the answer would use it. */
const PART_WORDS: Record<PartKind, string> = {
  text: 'text',
  thinking: 'thinking',
  toolCall: 'tool call',
  toolResult: 'tool result',
};

/** A tool's answer to a call, which is where a file's contents are. */
export type ToolResult = Extract<Part, { kind: 'toolResult' }>;

/**
 * One turn's body of a given kind.
 *
 * The flattened turn is what a summary can carry; this is what it cannot — the
 * reasoning behind an answer, the arguments a tool was actually handed, the whole
 * of something a tool handed back.
 *
 * A turn with none of it says what it does have. "No thinking here" on its own
 * leaves the reader to wonder whether they asked the wrong turn or whether they
 * asked for the wrong thing, and the answer to that is the list of what is there.
 */
export function renderBody(turn: NumberedTurn, parts: readonly Part[], kind: PartKind): string {
  const wanted = parts.filter((part) => part.kind === kind);

  if (wanted.length === 0) {
    const has = [...new Set(parts.map((part) => PART_WORDS[part.kind]))];

    return has.length === 0
      ? `Turn ${turn.number} has nothing stored on it to read.`
      : `Turn ${turn.number} has no ${PART_WORDS[kind]} in it. It has: ${has.join(', ')}.`;
  }

  const body = wanted.map((part) => clip(part.text, QUOTED)).join('\n\n');

  return `#${turn.number} (${NAMED[turn.turn.speaker]}, ${turn.at}) — ${PART_WORDS[kind]}:\n${body}`;
}

/**
 * A page of a file a tool read, with where the rest of it is.
 *
 * Which page of how many is said every time, because the end of a page and the
 * end of a file look the same and only one of them means the file stops there.
 * A read that failed says so rather than showing the failure as though it were
 * the file: an error message where contents are expected is read as contents.
 */
export function renderFile(
  turn: NumberedTurn,
  path: string,
  result: ToolResult,
  page: Page,
): string {
  const who = `#${turn.number} (${NAMED[turn.turn.speaker]}, ${turn.at})`;
  const head = result.failed
    ? `${who} — the read of ${path} failed:`
    : `${who} — ${path}, page ${page.page} of ${page.pages}:`;
  const rest = page.page < page.pages ? `\n\nPage ${page.page + 1} has the rest.` : '';

  return `${head}\n${page.text}${rest}`;
}

/** The turn was asked about a file it never touched. */
export function renderNoFile(turn: NumberedTurn, path: string, touched: readonly string[]): string {
  if (touched.length === 0) return `Turn ${turn.number} touched no files.`;

  return `Turn ${turn.number} did not touch ${path}. It touched: ${touched.join(', ')}.`;
}

/** The turn reached for the file, but this chat does not hold what came back. */
export function renderNoResult(turn: NumberedTurn, path: string): string {
  return `Turn ${turn.number} reached for ${path}, but what came back is not in this chat.`;
}

/** A page the text does not have. */
export function renderNoPage(path: string, pages: number, asked: number): string {
  return `${path} has ${pages} page${pages === 1 ? '' : 's'}; there is no page ${asked}.`;
}

/**
 * What a search found, or that the chat does not say it.
 *
 * A full page is said to be a full page. The cap is a real limit, and an answer
 * that just stopped at twenty would read exactly like a chat that only had twenty
 * — which is the difference between "that is all there is" and "ask me again
 * differently", and a model cannot tell them apart unless it is told.
 */
export function renderFound(found: readonly Found[], words: string): string {
  if (found.length === 0) return `This chat says nothing about "${words}".`;

  const lines = found.map(
    (each) => `#${each.number} (${NAMED[each.speaker]}): ${clip(each.turn.text, SNIPPET)}`,
  );
  const lede = `Found ${found.length} turn${found.length === 1 ? '' : 's'} about "${words}":`;

  return searchAnswer(lede, lines);
}

const CAP_NOTE = 'That is as many as one search returns; narrow it to see more.';

/** A search's answer: what it found, and whether asking differently finds more. */
function searchAnswer(lede: string, lines: readonly string[]): string {
  const more = lines.length >= FOUND ? `\n\n${CAP_NOTE}` : '';

  return `${lede}\n\n${lines.join('\n')}${more}`;
}

/**
 * What a workspace-wide search found, saying which chat each hit was said in.
 *
 * A number appears only against this chat's own turns. It is the handle `recall`
 * takes, and a number from a chat nobody is standing in would name a turn that
 * cannot be read back — the same trap as a summary full of numbers that resolve
 * to nothing — so a hit from elsewhere is named by its chat instead.
 */
export function renderFoundAcross(found: readonly FoundAcross[], words: string): string {
  if (found.length === 0) return `This workspace says nothing about "${words}".`;

  const lines = found.map((each) => {
    const where = each.from === null ? `#${each.number}` : `"${each.from}"`;

    return `${where} (${NAMED[each.speaker]}): ${clip(each.turn.text, SNIPPET)}`;
  });
  const lede = `Found ${found.length} turn${found.length === 1 ? '' : 's'} about "${words}", across this workspace:`;

  return searchAnswer(lede, lines);
}
