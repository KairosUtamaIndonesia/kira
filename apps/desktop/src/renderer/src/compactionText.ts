/**
 * What a compaction boundary says.
 *
 * Beside the component that draws it, and separate from it, so the sentence is
 * read and tested without a window around it. This row is the only place a reader
 * learns that part of their chat is no longer in front of the model, so what it
 * says is worth getting exactly right and worth a test of its own.
 */
import type { ChatPart } from '../../preload/bridge';

/** As much of a boundary as the sentence needs. */
type Summarised = Pick<Extract<ChatPart, { type: 'compaction' }>, 'messages' | 'lastWords'>;

/** How much of the last thing asked fits on the row before it is cut short. */
const QUOTE = 48;

/**
 * The boundary's one line: how much went, and where the cut fell.
 *
 * The quoted words are the last thing the person asked before the cut. With
 * nothing to quote — a stretch that was only tool calls, or a compaction pi wrote
 * itself — the count stands alone, which is a whole sentence rather than half of
 * one.
 */
export function summarised(part: Summarised): string {
  const counted = `Summarised ${part.messages} earlier message${part.messages === 1 ? '' : 's'}`;
  const asked = part.lastWords;

  return asked === null ? counted : `${counted}, through “${shorten(asked)}”`;
}

/** Long enough to recognise what was asked, short enough not to move the rule. */
function shorten(text: string): string {
  return text.length > QUOTE ? `${text.slice(0, QUOTE - 1).trimEnd()}…` : text;
}
