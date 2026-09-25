/**
 * The chat channels' handlers.
 *
 * The names are part of the shared contract, so they live in `preload/bridge.ts`
 * and the preload and `ipc/` both import them; only the handlers are here. Apart
 * from electron this folder knows nothing about how it is reached, so these can
 * be exercised with plain objects. Everything crossing this seam is Kira's
 * vocabulary: no pi types and no pi words reach the renderer.
 */
import {
  CHAT_CHANNELS,
  type ChatMode,
  type ChatState,
  type QueuedLine,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId, nothing, withId } from './result.ts';

export { CHAT_CHANNELS };

/** What the handlers need from the main process. */
export interface ChatDeps {
  /** The whole surface: chats, current chat, transcript. */
  state(): ChatState;
  send(text: string): Promise<void>;
  setMode?(mode: ChatMode): Promise<void>;
  approveProposal?(proposalId: string): Promise<void>;
  rejectProposal?(proposalId: string): Promise<void>;
  sendBackOutcome?(proposalId: string): Promise<void>;
  retryBreakdownReady?(): Promise<void>;
  answerQuestionnaire?(threadId: string, requestId: string, result: unknown): boolean;
  cancelQuestionnaire?(threadId: string, requestId: string): boolean;
  queue(text: string, lane: QueuedLine['lane']): Promise<void>;
  takeQueuedBack(): QueuedLine[];
  stop(): Promise<QueuedLine[]>;
  /** Summarise the chat on screen now, at this boundary rather than at pi's. */
  compact(): Promise<void>;
  /** Start a chat, filed under `workspaceId` when there is one. */
  start(workspaceId: string | null): Promise<void>;
  open(id: string): Promise<void>;
  branch(messageId: string): Promise<void>;
  edit(messageId: string): Promise<void>;
  fork(messageId: string): Promise<void>;
  /** Put a chat away, leaving everything it holds where it is. */
  archiveChat(id: string): Promise<void>;
  /** Bring a chat back from being put away. */
  restoreChat(id: string): Promise<void>;
  /** Throw a chat away, and everything said in it. */
  deleteChat(id: string): Promise<void>;
}

export interface ChatHandlers {
  load(): Promise<Result<ChatState>>;
  send(text: unknown): Promise<Result<null>>;
  setMode(mode: unknown): Promise<Result<null>>;
  queue(text: unknown, lane: unknown): Promise<Result<null>>;
  unqueue(): Promise<Result<QueuedLine[]>>;
  stop(): Promise<Result<QueuedLine[]>>;
  compact(): Promise<Result<null>>;
  start(workspaceId: unknown): Promise<Result<null>>;
  open(id: unknown): Promise<Result<null>>;
  branch(messageId: unknown): Promise<Result<null>>;
  edit(messageId: unknown): Promise<Result<null>>;
  fork(messageId: unknown): Promise<Result<null>>;
  archive(id: unknown): Promise<Result<null>>;
  restore(id: unknown): Promise<Result<null>>;
  delete(id: unknown): Promise<Result<null>>;
}

export interface ShapeChatHandlers {
  approveProposal(proposalId: unknown): Promise<Result<null>>;
  rejectProposal(proposalId: unknown): Promise<Result<null>>;
  sendBackOutcome(proposalId: unknown): Promise<Result<null>>;
  retryBreakdownReady(): Promise<Result<null>>;
  answerQuestionnaire(
    threadId: unknown,
    requestId: unknown,
    result: unknown,
  ): Promise<Result<null>>;
  cancelQuestionnaire(threadId: unknown, requestId: unknown): Promise<Result<null>>;
}

export function chatHandlers({
  state,
  send,
  setMode,
  approveProposal,
  rejectProposal,
  sendBackOutcome,
  retryBreakdownReady,
  answerQuestionnaire,
  cancelQuestionnaire,
  queue,
  takeQueuedBack,
  stop,
  compact,
  start,
  open,
  branch,
  edit,
  fork,
  archiveChat,
  restoreChat,
  deleteChat,
}: ChatDeps): ChatHandlers & ShapeChatHandlers {
  return {
    load: () => envelope(() => state()),

    setMode: (mode) => {
      if (mode !== 'build' && mode !== 'spec') {
        return Promise.resolve({ ok: false, error: 'A chat mode must be Build or Spec.' });
      }
      if (setMode === undefined) {
        return Promise.resolve({ ok: false, error: 'Changing chat mode is unavailable.' });
      }
      return nothing(() => setMode(mode));
    },

    send: (text) => {
      // The renderer is a trust boundary: an argument arrives as whatever it
      // sent, so it is checked before it reaches an agent turn.
      if (typeof text !== 'string' || text.trim() === '') {
        return Promise.resolve({
          ok: false,
          error: 'A message needs some text.',
        });
      }

      return nothing(() => send(text));
    },

    approveProposal: (proposalId) => {
      if (typeof proposalId !== 'string' || proposalId.trim() === '') {
        return Promise.resolve({ ok: false, error: 'A proposal needs an id.' });
      }
      if (approveProposal === undefined) {
        return Promise.resolve({ ok: false, error: 'Proposal approval is unavailable.' });
      }
      return nothing(() => approveProposal(proposalId));
    },
    rejectProposal: (proposalId) => {
      if (typeof proposalId !== 'string' || proposalId.trim() === '') {
        return Promise.resolve({ ok: false, error: 'A proposal needs an id.' });
      }
      if (rejectProposal === undefined) {
        return Promise.resolve({ ok: false, error: 'Proposal rejection is unavailable.' });
      }
      return nothing(() => rejectProposal(proposalId));
    },
    sendBackOutcome: (proposalId) => {
      if (typeof proposalId !== 'string' || proposalId.trim() === '') {
        return Promise.resolve({
          ok: false,
          error: 'An Outcome proposal needs an id.',
        });
      }
      if (sendBackOutcome === undefined) {
        return Promise.resolve({
          ok: false,
          error: 'Outcome review is unavailable.',
        });
      }
      return nothing(() => sendBackOutcome(proposalId));
    },
    retryBreakdownReady: () => {
      if (retryBreakdownReady === undefined) {
        return Promise.resolve({ ok: false, error: 'Breakdown readiness retry is unavailable.' });
      }
      return nothing(retryBreakdownReady);
    },
    answerQuestionnaire: (threadId, requestId, result) => {
      if (!isId(threadId) || !isId(requestId)) {
        return Promise.resolve({ ok: false, error: 'A question needs a chat and request id.' });
      }
      if (answerQuestionnaire?.(threadId, requestId, result) !== true) {
        return Promise.resolve({
          ok: false,
          error: 'That question is no longer waiting, or the answers are invalid.',
        });
      }
      return Promise.resolve({ ok: true, value: null });
    },
    cancelQuestionnaire: (threadId, requestId) => {
      if (!isId(threadId) || !isId(requestId)) {
        return Promise.resolve({ ok: false, error: 'A question needs a chat and request id.' });
      }
      if (cancelQuestionnaire?.(threadId, requestId) !== true) {
        return Promise.resolve({ ok: false, error: 'That question is no longer waiting.' });
      }
      return Promise.resolve({ ok: true, value: null });
    },

    queue: (text, lane) => {
      if (typeof text !== 'string' || text.trim() === '') {
        return Promise.resolve({
          ok: false,
          error: 'A message needs some text.',
        });
      }

      if (!isLane(lane)) {
        return Promise.resolve({
          ok: false,
          error: 'A message waits for her next step or for later.',
        });
      }

      return nothing(() => queue(text, lane));
    },

    unqueue: () => envelope(takeQueuedBack),

    stop: () => envelope(stop),

    compact: () => nothing(compact),

    start: (workspaceId) => {
      if (!isWorkspaceId(workspaceId)) {
        return Promise.resolve({
          ok: false,
          error: 'A chat starts in a workspace or nowhere.',
        });
      }

      return nothing(() => start(workspaceId));
    },

    open: (id) => withId(id, 'A chat needs an id.', open),

    branch: (messageId) => withId(messageId, 'A branch needs a message id.', branch),

    edit: (messageId) => withId(messageId, 'An edit needs a message id.', edit),

    fork: (messageId) => withId(messageId, 'A fork needs a message id.', fork),

    archive: (id) => withId(id, 'A chat needs an id to be put away.', archiveChat),

    restore: (id) => withId(id, 'A chat needs an id to be brought back.', restoreChat),

    delete: (id) => withId(id, 'A chat needs an id to be deleted.', deleteChat),
  };
}

/** A lane as it arrives from the renderer: only the two turns there are. */
function isLane(value: unknown): value is QueuedLine['lane'] {
  return value === 'next' || value === 'later';
}

/** The workspace an incoming start files a chat under: an id, or nothing at all. */
function isWorkspaceId(value: unknown): value is string | null {
  return value === null || isId(value);
}
