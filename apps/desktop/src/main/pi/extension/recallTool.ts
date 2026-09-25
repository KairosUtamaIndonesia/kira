/**
 * Kira's look-up tool, as pi is handed it.
 *
 * A compaction takes a chat's earlier turns out of what she is shown. Without
 * this she would be holding a conversation whose opening she cannot read and
 * cannot quote: what she remembers is text she has no way to check, and the
 * honest move — asking again — is the one that wastes the work already done.
 * With it, the turns are still in the session; what was removed is her sight of
 * them, and this gives it back on request.
 *
 * The answers are worked out by `recall.ts`, which is pure and knows none of
 * this. What lives here is the part that only pi can supply: the parameters a
 * model is asked for, and the chat to read them against.
 *
 * Recall is deliberately not automatic. It is a tool Kira has to reach for, so
 * that the transcript shows when she checked rather than remembered — the
 * difference between an answer she verified and one she guessed being exactly
 * what a reader needs to see.
 */
import type { SessionEntry, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ThreadStore } from '../../db/threads.ts';
import {
  entryFor,
  numberedIn,
  partsIn,
  resultOf,
  titleOf,
  turnsStoredIn,
  type NumberedTurn,
} from './entries.ts';
import {
  paged,
  renderBody,
  renderFile,
  renderFound,
  renderFoundAcross,
  renderNoFile,
  renderNoPage,
  renderNoResult,
  renderTurn,
  samePath,
  searchAcross,
  searchIn,
  turnAt,
  type Chat,
} from './recall.ts';

/** What Kira is asked to fill in when she looks something up. */
const PARAMETERS = Type.Object({
  number: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'A turn to read back, by the number it was given. Counting only turns, so the number does not change as the chat goes on.',
    }),
  ),
  search: Type.Optional(
    Type.String({
      description:
        'Words to find. Every turn holding them is listed, and a turn in this chat can then be read back whole by number.',
    }),
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal('chat'), Type.Literal('workspace')], {
      description:
        'What a `search` looks in. "chat" (the default) is this chat alone. "workspace" is every chat filed under the same workspace, which is how work settled elsewhere is found without knowing which chat it was in — a hit from another chat is named by that chat rather than by a turn number, because a number belongs to the chat it came from.',
    }),
  ),
  observation: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'Something Kira is holding, by its identifier, traced back to the turn it was drawn from.',
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        'A file to read the recorded contents of, on the turn given by `number` — as it was read or written on that turn. Long files come back one page at a time; ask for the next with `page`.',
    }),
  ),
  kind: Type.Optional(
    Type.Union(
      [
        Type.Literal('text'),
        Type.Literal('thinking'),
        Type.Literal('toolCall'),
        Type.Literal('toolResult'),
      ],
      {
        description:
          "Which part of the turn to read on the turn given by `number`: what was said, what Kira was thinking, a tool's arguments, or what a tool handed back.",
      },
    ),
  ),
  page: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Which page of a file to read. The first page says how many there are.',
    }),
  ),
});

/** How the tool is described to the model. */
const DESCRIPTION = [
  'Look something up: an earlier turn, what a turn was made of, a file it touched, or the turns that say a thing.',
  'A search can look in this chat or across the whole workspace this chat is filed under, which is how work settled',
  'in another chat is found without remembering which chat it was in. Use it when the answer is in the conversation',
  'but not in what you can currently see — turns before a compaction are still there, and so is everything you were',
  'told and have since been shown only a summary of. Checking is not remembering: this is how you check.',
].join(' ');

/**
 * Build the tool, bound to one chat.
 *
 * The branch is read when the tool is called rather than when it is built, because
 * the point of a look-up is that the chat has gone on since: a snapshot taken at
 * session start would be answering about a conversation that no longer exists.
 * It comes from the session rather than the database because the session is what
 * the run is actually against, and because the database is only reconciled when a
 * chat is opened.
 *
 * What is held is read from the store, because memory outlives any one session,
 * and so are the other chats of a workspace: they are chats this session has never
 * held and cannot read out of pi.
 */
export function recallTool(
  store: ThreadStore,
  threadId: string,
): ToolDefinition<typeof PARAMETERS> {
  return {
    name: 'recall',
    label: 'Look something up',
    description: DESCRIPTION,
    promptSnippet:
      'Look up an earlier turn, what a turn was made of, a file it touched, or search what was said — in this chat, or across the chats of this workspace.',
    parameters: PARAMETERS,
    executionMode: 'parallel',

    async execute(_id, params, _signal, _update, ctx) {
      const branch = ctx.sessionManager.getBranch();
      const turns = numberedIn(turnsStoredIn(branch));

      if (params.observation !== undefined) {
        return spoke(heldSourceIn(store, threadId, params.observation, turns));
      }

      if (params.search !== undefined) {
        const across = params.scope === 'workspace' ? searchedIn(store, threadId, turns) : null;

        return spoke(
          across === null || across.length === 1
            ? renderFound(searchIn(turns, params.search), params.search)
            : renderFoundAcross(searchAcross(across, params.search), params.search),
        );
      }

      if (params.number !== undefined) {
        const turn = turnAt(turns, params.number);
        if (turn === null) {
          return spoke(`This chat has no turn ${params.number}; it has ${turns.length}.`);
        }

        if (params.path !== undefined) {
          return spoke(readFile(branch, turn, params.path, params.page ?? 1));
        }

        if (params.kind !== undefined) {
          const entry = entryFor(branch, turn.entryId);

          return spoke(renderBody(turn, entry === null ? [] : partsIn(entry), params.kind));
        }

        return spoke(renderTurn(turn));
      }

      if (params.path !== undefined || params.kind !== undefined) {
        return spoke(
          'A file or a part of a turn is read by number, so say which turn it is on as well.',
        );
      }

      return spoke(
        'Say what to look up: `number` for one turn, `search` for words, `observation` for something Kira is holding, or `number` with `path` or `kind` to read a turn again.',
      );
    },
  };
}

/**
 * The recorded contents of a file, as one turn touched it.
 *
 * The file is found by looking at what the turn's tool calls were aimed at, and
 * what came back for it is found by the identifier the call carried rather than by
 * the next entry — a turn can reach for two tools at once, and then the answers
 * come back in an order the calls do not.
 */
function readFile(
  branch: readonly SessionEntry[],
  turn: NumberedTurn,
  path: string,
  page: number,
): string {
  const entry = entryFor(branch, turn.entryId);
  const parts = entry === null ? [] : partsIn(entry);
  const calls = parts.filter((part) => part.kind === 'toolCall');
  const aimed = calls.filter((call) => call.path !== undefined);
  const call = aimed.find((each) => samePath(each.path ?? '', path));

  if (call === undefined) {
    return renderNoFile(
      turn,
      path,
      aimed.map((each) => each.path ?? ''),
    );
  }

  const result = resultOf(branch, call.callId);
  if (result === null || result.kind !== 'toolResult') return renderNoResult(turn, path);

  const wanted = paged(result.text, page);
  if (wanted === null) return renderNoPage(path, paged(result.text, 1)?.pages ?? 1, page);

  return renderFile(turn, path, result, wanted);
}

/**
 * Something Kira is holding, taken back to the turn it was drawn from.
 *
 * The turn is quoted beside it, because the point of tracing an observation is to
 * read what it was drawn from — an answer that named a number and stopped would
 * send her straight back to ask for it.
 */
function heldSourceIn(
  store: ThreadStore,
  threadId: string,
  id: number,
  turns: ReturnType<typeof numberedIn>,
): string {
  const holding = store.loadObservations(threadId).find((each) => each.id === id);
  if (holding === undefined) {
    return `This chat is not holding anything with the identifier ${id}.`;
  }

  const at = turns.findIndex((turn) => turn.entryId === holding.entryId);
  const turn = at === -1 ? null : turnAt(turns, at + 1);

  return `"${holding.text}" was drawn from ${
    turn === null ? 'a turn this chat no longer holds' : `#${turn.number}`
  }:\n\n${turn === null ? '' : renderTurn(turn)}`;
}

/** Wrap text as pi expects a tool's result. */
/**
 * The chats a workspace-scoped search looks in: this one first, then the others.
 *
 * This chat goes first and unnamed, because its hits keep the turn numbers the
 * reader can act on. A sibling is named by what the person calls it in the chat
 * list, and its own turns are read from the branch it stands on rather than from
 * every entry it holds — an abandoned branch is not work anybody is doing.
 *
 * One chat on its own means there is nowhere else to look: a chat filed under no
 * workspace, or the only chat in one. The caller then answers about this chat,
 * which is both what is true and what reads right.
 */
function searchedIn(store: ThreadStore, threadId: string, here: readonly NumberedTurn[]): Chat[] {
  const hereAlone: Chat[] = [{ name: null, turns: here }];
  const workspaceId = store.findThread(threadId)?.workspaceId;
  if (workspaceId === null || workspaceId === undefined) return hereAlone;

  return [
    ...hereAlone,
    ...store.loadWorkspaceThreads(workspaceId, threadId).map((thread) => {
      const branch = turnsStoredIn(store.branchEntries(thread.id));

      return { name: titleOf(branch), turns: numberedIn(branch) };
    }),
  ];
}

/** Wrap text as pi expects a tool's result. */
function spoke(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}
