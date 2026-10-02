/**
 * What a ticket's typed fields ask the server to change when a person leaves them.
 *
 * A ticket is corrected where it is read, so its fields commit on blur rather than through a
 * form. Only the fields a person types into need deciding: a picker already knows what its
 * click changes. Each function is handed what the server holds and what was typed, and answers
 * with the change to send — or `null` when there is nothing to say, because the words are
 * already what the server has, or because saying them would leave a ticket unnamed.
 *
 * Plain TypeScript with no React, so the decision is testable without a browser.
 */
import type { TicketChange } from '../../preload/bridge.ts';

/** A title is the one field never emptied: a ticket with no title is a ticket with no name. */
export function titleChange(held: string, typed: string): TicketChange | null {
  const title = typed.trim();
  if (title === '' || title === held.trim()) return null;

  return { title };
}

/** A description may be emptied. Having nothing to say about a ticket is a real draft. */
export function bodyChange(held: string, typed: string): TicketChange | null {
  return typed === held ? null : { body: typed };
}

/**
 * The checks a ticket is done when, sent as the whole list the server stores: one line changing
 * sends them all. Blank lines are dropped and every check is trimmed, so the empty row a person
 * adds contributes nothing until something is typed in it.
 */
export function checksChange(
  held: readonly string[],
  typed: readonly string[],
): TicketChange | null {
  const criteria = typed.map((line) => line.trim()).filter((line) => line !== '');
  const heldTrimmed = held.map((line) => line.trim());
  const same =
    heldTrimmed.length === criteria.length &&
    heldTrimmed.every((line, at) => line === criteria[at]);
  if (same) return null;

  return { criteria };
}
