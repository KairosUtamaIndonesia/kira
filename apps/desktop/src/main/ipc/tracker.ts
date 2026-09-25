/**
 * The tracker channels' handlers.
 *
 * The Work surface's own seam: reading a project's queue, writing a ticket down,
 * changing what one says, and naming or taking off a gate. Every one of these is
 * a call to the server, so the handlers are thin on purpose — what they add is the
 * check that the window sent something a server could be asked, and the envelope
 * that turns a failure into a message.
 *
 * A refusal is not invented here. The server is the party that knows why it would
 * not take a ticket without acceptance criteria, or why a gate would close a
 * circle, and its own sentence is what reaches the person — "that could not be
 * saved" would leave them nothing to act on.
 */
import {
  TICKET_CLOSURES,
  TICKET_GATES,
  TICKET_KINDS,
  TRACKER_CHANNELS,
  type Closure,
  type Gate,
  type GlossaryEntry,
  type Result,
  type Ticket,
  type TicketChange,
  type TicketDraft,
  type TicketKind,
  type TicketQueue,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { TRACKER_CHANNELS };

/** What the handlers need from the main process. */
export interface TrackerDeps {
  /** The queue of the project this workspace works, or a throw saying why not. */
  queue(workspaceId: string): Promise<TicketQueue>;
  /** Open or resume the author-owned linked question chat. */
  openQuestion?(workspaceId: string, ticketId: string): Promise<Ticket>;
  /** Write a ticket down, answering the ticket the server wrote. */
  write(workspaceId: string, draft: TicketDraft): Promise<Ticket>;
  /** Write what changed about a ticket, answering it as it stands afterwards. */
  change(ticketId: string, change: TicketChange): Promise<Ticket>;
  /** Name a ticket that gates this one. */
  gate(ticketId: string, gatedBy: string): Promise<Ticket>;
  /** Take a gate off a ticket. */
  ungate(ticketId: string, gatedBy: string): Promise<Ticket>;
  /** Restore a glossary entry only if its visible version still matches. */
  undoGlossary?(
    workspaceId: string,
    entryId: string,
    version: number,
    chatId: string,
  ): Promise<GlossaryEntry>;
}

export interface TrackerHandlers {
  queue(workspaceId: unknown): Promise<Result<TicketQueue>>;
  write(workspaceId: unknown, draft: unknown): Promise<Result<Ticket>>;
  change(ticketId: unknown, change: unknown): Promise<Result<Ticket>>;
  gate(ticketId: unknown, gatedBy: unknown): Promise<Result<Ticket>>;
  ungate(ticketId: unknown, gatedBy: unknown): Promise<Result<Ticket>>;
  undoGlossary(
    workspaceId: unknown,
    entryId: unknown,
    version: unknown,
    chatId: unknown,
  ): Promise<Result<GlossaryEntry>>;
}

export interface QuestionTrackerHandlers {
  questionChat(workspaceId: unknown, ticketId: unknown): Promise<Result<Ticket>>;
}

export function trackerHandlers({
  queue,
  openQuestion,
  write,
  change,
  gate,
  ungate,
  undoGlossary,
}: TrackerDeps): TrackerHandlers & QuestionTrackerHandlers {
  return {
    queue: (workspaceId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A queue is read for a workspace.' });
      }

      return envelope(() => queue(workspaceId));
    },

    questionChat: (workspaceId, ticketId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A question chat starts in a workspace.' });
      }
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A question chat needs a ticket.' });
      }
      if (openQuestion === undefined) {
        return Promise.resolve({ ok: false, error: 'Question chats are unavailable.' });
      }
      return envelope(() => openQuestion(workspaceId, ticketId));
    },

    write: (workspaceId, draft) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A ticket is written in a workspace.' });
      }

      const asked = draftIn(draft);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a ticket to write.' });
      }

      return envelope(() => write(workspaceId, asked));
    },

    change: (ticketId, patch) => {
      if (!isId(ticketId)) {
        return Promise.resolve({ ok: false, error: 'A ticket needs an id to be changed.' });
      }

      const asked = changeIn(patch);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a change to a ticket.' });
      }

      return envelope(() => change(ticketId, asked));
    },

    gate: (ticketId, gatedBy) =>
      gateCall('A ticket needs an id to be gated.', ticketId, gatedBy, gate),

    ungate: (ticketId, gatedBy) =>
      gateCall('A ticket needs an id to be ungated.', ticketId, gatedBy, ungate),

    undoGlossary: (workspaceId, entryId, version, chatId) => {
      if (!isId(workspaceId)) {
        return Promise.resolve({ ok: false, error: 'A glossary is undone in a workspace.' });
      }
      if (!isId(entryId)) {
        return Promise.resolve({ ok: false, error: 'A glossary entry needs an id to be undone.' });
      }
      if (!Number.isInteger(version) || (version as number) < 1) {
        return Promise.resolve({ ok: false, error: 'A glossary Undo needs a version.' });
      }
      if (!isId(chatId)) {
        return Promise.resolve({ ok: false, error: 'A glossary change needs its chat.' });
      }

      if (undoGlossary === undefined) {
        return Promise.resolve({ ok: false, error: 'Glossary undo is unavailable.' });
      }

      return envelope(() => undoGlossary(workspaceId, entryId, version as number, chatId));
    },
  };
}

/**
 * A gate being named or taken off, checked the same way both times.
 *
 * What gates a ticket is named by whatever a person would say — `FND-12` as
 * readily as an id — so the reference is only checked for being something rather
 * than for being an id: which ticket it names is the server's to resolve, and a
 * name that names nothing is its refusal to give.
 */
function gateCall(
  complaint: string,
  ticketId: unknown,
  gatedBy: unknown,
  act: (ticketId: string, gatedBy: string) => Promise<Ticket>,
): Promise<Result<Ticket>> {
  if (!isId(ticketId)) return Promise.resolve({ ok: false, error: complaint });
  if (typeof gatedBy !== 'string' || gatedBy.trim() === '') {
    return Promise.resolve({ ok: false, error: 'A gate names a ticket.' });
  }

  return envelope(() => act(ticketId, gatedBy));
}

/** A ticket being written, or null when it is not one. */
function draftIn(value: unknown): TicketDraft | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as {
    kind?: unknown;
    title?: unknown;
    body?: unknown;
    criteria?: unknown;
    sourceChatId?: unknown;
  };

  if (!TICKET_KINDS.includes(held.kind as TicketKind)) return null;
  if (typeof held.title !== 'string' || typeof held.body !== 'string') return null;
  if (held.sourceChatId !== undefined && !isId(held.sourceChatId)) return null;

  const criteria = criteriaIn(held.criteria);
  if (criteria === null) return null;

  return {
    kind: held.kind as TicketKind,
    title: held.title,
    body: held.body,
    criteria,
    ...(held.sourceChatId === undefined ? {} : { sourceChatId: held.sourceChatId }),
  };
}

/** A change to a ticket, or null when it is not one. */
function changeIn(value: unknown): TicketChange | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as Record<string, unknown>;
  const change: TicketChange = {};

  if (held.title !== undefined) {
    if (typeof held.title !== 'string') return null;
    change.title = held.title;
  }
  if (held.body !== undefined) {
    if (typeof held.body !== 'string') return null;
    change.body = held.body;
  }
  if (held.criteria !== undefined) {
    const criteria = criteriaIn(held.criteria);
    if (criteria === null) return null;
    change.criteria = criteria;
  }
  if (held.gate !== undefined) {
    if (!TICKET_GATES.includes(held.gate as Gate)) return null;
    change.gate = held.gate as Gate;
  }
  if (held.rank !== undefined) {
    if (!Number.isInteger(held.rank)) return null;
    change.rank = held.rank as number;
  }
  if (held.closure !== undefined) {
    if (!TICKET_CLOSURES.includes(held.closure as Closure)) return null;
    change.closure = held.closure as Closure;
  }

  return change;
}

/** Criteria as they arrive: every one a line of text, which is all a criterion is. */
function criteriaIn(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((each) => typeof each === 'string')) return null;

  return value as string[];
}
