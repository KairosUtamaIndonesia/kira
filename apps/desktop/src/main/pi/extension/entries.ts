/**
 * pi's stored entries, read as turns.
 *
 * The one place that knows the shape of pi's messages: which of them are words,
 * which are a tool handing something back, and which carry nothing worth keeping.
 * Everything downstream — the summary a compaction writes, the memory taken from
 * a chat as it runs — works in `turn.ts`'s vocabulary, so an upgrade of pi has
 * this file to break and cannot reach the logic beyond it.
 */
import type { FileEntry, SessionMessageEntry } from '@earendil-works/pi-coding-agent';
import type { Part, Speaker, ToolUse, Turn } from './turn.ts';

/** One thing the person, Kira or a tool said, as pi holds it. */
type Said = SessionMessageEntry['message'];

/**
 * One entry of a stored chat: a message, a note pi keeps about one, or the
 * session header a chat begins with. The header is the one entry pi writes
 * straight into its list rather than through persistence, so anything that reads
 * a chat back out of the database has to expect it — which is why every reader
 * here narrows by `type` before it reads anything else.
 */
type Stored = FileEntry;

/** One turn of a chat, and the entry it is stored as. */
export interface StoredTurn {
  entryId: string;
  /** When the turn happened, as the entry records it. */
  at: string;
  turn: Turn;
}

/**
 * A turn, and the number a chat knows it by.
 *
 * The number is where the turn sits among the chat's turns, counting from one,
 * over the entries that carry a message. It stays put as the chat goes on, which
 * is the point of it: turns are only ever added, and the entry a compaction
 * writes carries no message, so nothing that already has a number can move. A
 * summary can therefore name a turn, and be read correctly later.
 */
export interface NumberedTurn extends StoredTurn {
  number: number;
}

/**
 * Number a chat's turns from one, in the order they were said.
 *
 * The branch, not the tree: a chat that has been forked or edited holds turns on
 * branches it is not on, and a number that counted those would mean different
 * things to two reads of the same conversation.
 */
export function numberedIn(branch: readonly StoredTurn[]): NumberedTurn[] {
  return branch.map((turn, index) => ({ ...turn, number: index + 1 }));
}

/**
 * The turns of a stored branch, each with the entry it is stored as.
 *
 * Only the messages in it. A branch also holds a compaction entry an earlier run
 * wrote, and the summary of the branch it was forked from — Kira's own accounts of
 * conversations, rather than the conversations. What is read out of a chat is
 * what was actually said and done, so reading the accounts as well would find
 * nothing in them and risk finding a goal nobody stated in a summary somebody
 * wrote.
 */
export function turnsStoredIn(entries: readonly Stored[]): StoredTurn[] {
  const turns: StoredTurn[] = [];

  for (const entry of entries) {
    if (entry.type !== 'message') continue;

    const turn = turnIn(entry.message);
    if (turn !== null) turns.push({ entryId: entry.id, at: entry.timestamp, turn });
  }

  return turns;
}

/**
 * The turns worth carrying, in the order they were said.
 */
export function turnsOf(messages: readonly Said[]): Turn[] {
  const turns: Turn[] = [];

  for (const message of messages) {
    const turn = turnIn(message);
    if (turn !== null) turns.push(turn);
  }

  return turns;
}

/**
 * What one entry was made of, rather than what it amounted to.
 *
 * A turn is a flattened account of a message — what was said, and a tool's name
 * where a tool was reached for. This is the message itself, kept in pieces, for
 * the question a flattened turn cannot answer: what a tool was actually handed,
 * what a tool handed back, and what Kira was thinking while she decided.
 */
export function partsIn(entry: Stored): Part[] {
  return entry.type === 'message' ? partsOf(entry.message) : [];
}

/**
 * The entry a stored turn came from, as it is held on the branch.
 *
 * Turns are read out of a branch in order, but not one for one: entries that
 * carry no message are skipped, so the entry behind turn twelve is found by its
 * identifier rather than by counting twelve in.
 */
export function entryFor(entries: readonly Stored[], entryId: string): Stored | null {
  return entries.find((entry) => entry.id === entryId) ?? null;
}

/**
 * What a tool handed back for a call, wherever on the branch it is.
 *
 * Found by the identifier rather than by position, because a call and its answer
 * are two messages: the call is on the turn that reached for the tool and the
 * answer is usually the turn after, and a turn between them — a second tool
 * reached for in the same breath — would put the two out of step.
 */
export function resultOf(entries: readonly Stored[], callId: string): Part | null {
  for (const entry of entries) {
    for (const part of partsIn(entry)) {
      if (part.kind === 'toolResult' && part.callId === callId) return part;
    }
  }

  return null;
}

/** The pieces one message is made of. */
function partsOf(message: Said): Part[] {
  switch (message.role) {
    case 'user':
      return typeof message.content === 'string'
        ? [{ kind: 'text', text: message.content }]
        : textParts(message.content);

    case 'assistant': {
      const parts: Part[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ kind: 'text', text: part.text });
        } else if (part.type === 'thinking') {
          parts.push({ kind: 'thinking', text: part.thinking });
        } else if (part.type === 'toolCall') {
          const { path } = aimed(part.name, part.arguments);
          parts.push({
            kind: 'toolCall',
            callId: part.id,
            name: part.name,
            text: written(part.arguments),
            ...(path === undefined ? {} : { path }),
          });
        }
      }

      return parts;
    }

    case 'toolResult': {
      const text = words(message.content);
      if (text === '') return [];

      return [
        {
          kind: 'toolResult',
          callId: message.toolCallId,
          name: message.toolName,
          text,
          failed: message.isError,
        },
      ];
    }

    case 'bashExecution':
      return [{ kind: 'text', text: `$ ${message.command}` }];

    case 'branchSummary':
      return [{ kind: 'text', text: message.summary }];

    default:
      return [];
  }
}

/** One part per piece of a message's content that carries words. */
function textParts(content: readonly { readonly type: string }[]): Part[] {
  const parts: Part[] = [];

  for (const part of content) {
    if (!('text' in part) || typeof part.text !== 'string' || part.text === '') continue;
    parts.push({ kind: 'text', text: part.text });
  }

  return parts;
}

/**
 * A tool's arguments as the model would have written them.
 *
 * Indented rather than compact, because these are read back by someone trying to
 * see what was asked for, and a single line of escaped JSON is not that.
 */
function written(args: Record<string, unknown>): string {
  const shown = JSON.stringify(args, null, 2);

  return typeof shown === 'string' ? shown : '';
}

/**
 * One message as a turn, or nothing when there is nothing in it to carry.
 *
 * Kept are the words that were said, the result a tool handed back, a command the
 * person ran themselves, and the summary of the branch this one was forked from —
 * all of it part of what happened. Dropped is a message with no words in it,
 * rather than carried as a blank line.
 */
function turnIn(message: Said): Turn | null {
  switch (message.role) {
    case 'user':
      return turn(
        'person',
        typeof message.content === 'string' ? message.content : words(message.content),
      );

    case 'assistant': {
      const tools: ToolUse[] = [];
      const said: string[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          said.push(part.text);
        } else if (part.type === 'toolCall') {
          tools.push(aimed(part.name, part.arguments));
          // Named rather than reproduced: a tool call's arguments are usually a
          // file's whole contents, and the transcript is not the place for them.
          // Which file it was about is kept, because that is what a later session
          // needs and cannot get back from a name alone.
          said.push(`[${part.name}]`);
        }
        // Thinking is left out on purpose. It is the working, not the answer,
        // and it is the largest thing in a turn by some way.
      }

      return turn('kira', said.filter((line) => line !== '').join('\n'), tools);
    }

    case 'toolResult':
      return turn('tool', words(message.content));

    // A command the person ran themselves, which is part of what happened even
    // though no model was involved.
    case 'bashExecution':
      return turn('tool', `$ ${message.command}`);

    // The summary of the branch this chat was forked from. It is what happened
    // before this chat existed, so it is carried as words.
    case 'branchSummary':
      return turn('kira', message.summary);

    // A message an extension put in the conversation rather than anyone saying
    // it. Deliberately dropped rather than listed as a role nobody played.
    case 'custom':
      return null;

    // Anything else is a shape this build has never seen and an upgrade of pi
    // could introduce, so it is carried as nothing rather than guessed at.
    default:
      return null;
  }
}

/**
 * A tool Kira reached for, and the file it was aimed at.
 *
 * The arguments are not carried, only what they were about: a tool call's
 * arguments are routinely a file's entire contents, and the one thing worth
 * keeping about it an hour later is which file it was.
 *
 * Every one of pi's file tools calls that argument `path`. A tool from somewhere
 * else — an extension, a server — may not, and its files would then go unnamed
 * rather than misnamed, which is the failure worth choosing. This is the one
 * place to add a spelling if one ever turns up.
 */
function aimed(name: string, args: Record<string, unknown>): ToolUse {
  const path = args.path;

  return typeof path === 'string' ? { name, path } : { name };
}

/**
 * One turn, or nothing when nobody said anything in it.
 *
 * A turn with tools and no words is still a turn: reaching for a tool is what
 * changes the files the work touched, and a chat where Kira worked without
 * narrating it would otherwise report that she touched nothing.
 */
function turn(speaker: Speaker, text: string, tools: readonly ToolUse[] = []): Turn | null {
  const said = text.trim();
  if (said === '' && tools.length === 0) return null;

  return speaker === 'kira' ? { speaker, text: said, tools } : { speaker, text: said };
}

/**
 * The words in a message's content.
 *
 * pi does not export the part types its messages are built from, so the parts are
 * read structurally: one that carries text contributes it, and one that does not
 * — an image, a thinking block — contributes nothing, because neither is
 * something a summary can hand on as words.
 */
function words(parts: readonly { readonly type: string }[]): string {
  const said: string[] = [];

  for (const part of parts) {
    if ('text' in part && typeof part.text === 'string') said.push(part.text);
  }

  return said.join('\n');
}

/** A label is one line, and short enough for a list. */
const TITLE_LENGTH = 48;

/**
 * What a chat is called: the first thing a person asked it.
 *
 * Derived rather than stored, so there is one source of truth and no title
 * column to migrate. Only a person's turn can name a chat — what Kira said, and
 * what a tool came to, are answers to a question, and an answer is not a name.
 *
 * Read from the branch the chat stands on rather than from every entry it holds.
 * A chat that went back and asked something else is called by the question it is
 * working on now, not by one it has left behind.
 */
export function titleOf(branch: readonly StoredTurn[]): string {
  const asked = branch.find((each) => each.turn.speaker === 'person');
  const title = asked === undefined ? '' : titleFrom(asked.turn.text);

  return title === '' ? 'New chat' : title;
}

/**
 * A chat is named by the first thing asked, and by the first line of it.
 *
 * Squashing the whole message into one line named a chat after as much of it as fitted,
 * which is a sentence cut off mid-word for anything written in paragraphs — and a run is
 * exactly that: its opening turn is a brief, and the first line of the brief is the ticket
 * it is running. So the name is the line somebody would say the chat is about, and a chat
 * whose first line is empty is named by the first line that is not (GH #68).
 */
function titleFrom(text: string): string {
  const first = text.split('\n').find((line) => line.trim() !== '') ?? '';
  const oneLine = first.replace(/\s+/g, ' ').trim();

  return oneLine.length > TITLE_LENGTH
    ? `${oneLine.slice(0, TITLE_LENGTH).trimEnd()}\u2026`
    : oneLine;
}
