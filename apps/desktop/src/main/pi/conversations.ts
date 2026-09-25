/**
 * Live conversations.
 *
 * `storage.ts` opens a thread as pi sees it; this module is what a running one
 * looks like: the session, its subscription, its listeners, and disposal. pi
 * keeps provider connections and timers alive, so an open session has to be
 * disposed — that is the job that lives here.
 *
 * Foundry's words stop at this boundary in both directions: pi's entries are
 * turned into transcript lines here, so nothing above has to know what a
 * session entry is.
 */
import type { AgentSessionEvent, FileEntry, SessionEntry } from '@earendil-works/pi-coding-agent';
import { basename, dirname } from 'node:path';
import type {
  ChatMode,
  ChatConclusion,
  ChatEvent,
  GlossaryChangeNote,
  ChatMemory,
  ChatMessage,
  ChatPart,
  ChatSummary,
  ChatTranscript,
  ChatUsage,
  DecisionProposal,
  MapProposal,
  OutcomeProposal,
  BreakdownProposal,
  BreakdownSlice,
  SpecProposal,
  MemoryKind,
  ToolImage,
  WorkspaceSummary,
  QueuedLine,
  ToolRun,
} from '../../preload/bridge.ts';
import type {
  ObservationRecord,
  StoredReflection,
  WorkspaceRecord,
  ThreadStore,
} from '../db/threads.ts';
import {
  type KiraSession,
  type WorkspacePreparer,
  forkSession,
  resumeSession,
  startSession,
} from './agent.ts';
import type { CompactionDetails } from './extension/compact.ts';
import { titleOf, turnsStoredIn } from './extension/entries.ts';
import { observationsIn } from './extension/memory.ts';
import { memoryRuns, type MemorySource } from '../memory.ts';
import type { Tracker } from '../tracker.ts';
import type { Models } from './models.ts';
import type { McpManager } from '../mcp/servers.ts';
import type { Questionnaires } from '../questionnaires.ts';
import { missingMessage } from './storage.ts';

/** A running conversation the window can read from, write to, and watch. */
export interface Conversation {
  readonly threadId: string;
  /** Change this chat's persistent Build/Spec mode and its next-turn tool set. */
  setMode(mode: ChatMode): Promise<void>;
  /** Change the shell used for this conversation's next Bash command. */
  setShellPath(path: string | undefined): Promise<void>;
  /**
   * The model this chat runs on, or null when it is running on none.
   *
   * Read from the session rather than from what is written down for the chat,
   * because the two can differ: a model the pool has stopped offering is
   * replaced by what it prefers, and this is what the window should be showing.
   */
  modelId(): string | null;
  /**
   * What this chat has used: what it has cost, and how full its window is.
   *
   * Read from the session every time rather than kept as a running total, so a
   * chat opened again reports the same numbers it reported before — the entries
   * are the record, and a counter kept beside them could only drift from it.
   */
  chatUsage(): ChatUsage;
  /**
   * Run this chat on the model `modelId` names, from the next message on.
   *
   * pi writes the change into the conversation, so the transcript records which
   * model said what rather than reading as one model's throughout. A model the
   * pool does not offer is refused here, because choosing one that cannot answer
   * is a trap rather than a choice.
   */
  choose(modelId: string): Promise<void>;
  /** The conversation as a tree, and the branch on screen. */
  transcript(): ChatTranscript;
  /**
   * What Kira is holding for this chat, in the order it was first said.
   *
   * Read straight from the database rather than from the session, because it
   * outlives the session: it is what the chat remembers once the turns that
   * produced it are gone, which is the whole point of it.
   */
  memory(): ChatMemory[];
  /**
   * What Kira has worked out for this chat, in the order she worked it out.
   *
   * Read from the database as her memory is, and apart from it: these are drawn
   * from what she was told rather than being more of it, and they carry the turn
   * each had read through, which nothing she was told has.
   */
  conclusions(): ChatConclusion[];
  /** Send one message and wait for the turn to finish. */
  send(text: string): Promise<void>;
  /**
   * Give Kira words to read at her next step: after the tool calls she is
   * running now, before she decides what to do with them. This is how a turn is
   * redirected rather than restarted — nothing already written is thrown away.
   *
   * With nothing being written there is no next step to steer, so the words are
   * simply said: writing while she answers is the point, and it should not fail
   * because she finished first.
   */
  steer(text: string): Promise<void>;
  /**
   * Summarise this chat now, rather than waiting for the window to fill.
   *
   * This is pi's manual compaction, the path `/compact` takes: it runs the same
   * `session_before_compact` hook a threshold compaction does, so what a chat
   * compacted by hand carries is Foundry's own reconstruction rather than a
   * model's summary. pi aborts a turn in flight first and starts nothing
   * afterwards, so compacting mid-answer ends that answer where it stands.
   *
   * Nothing has to be said for this to be visible: the boundary is left standing
   * at the end of the chat, and the transcript carries it there.
   *
   * A chat with nothing to summarise is refused, in Foundry's words rather than
   * pi's: see {@link compactionRefusal} for which refusals those are and why only
   * those are translated.
   */
  compact(): Promise<void>;
  /** The same, read once the turn she is in has finished. */
  followUp(text: string): Promise<void>;
  /** What is waiting to be read, in the order she will read it. */
  queued(): QueuedLine[];
  /**
   * Take everything still waiting back, in the order it would have been read.
   * The turn being written is left alone.
   */
  takeQueuedBack(): QueuedLine[];
  /**
   * Stop the reply being written in this chat, and hand back the words that were
   * still waiting. What Kira has written so far stays: pi ends the message it was
   * in the middle of and stores it, so a stopped reply is one that ends early
   * rather than one that never happened.
   *
   * pi's `abort` waits for the session to settle, so when this resolves the turn
   * is over and nothing is being written here.
   */
  stop(): Promise<QueuedLine[]>;
  /**
   * Show the branch ending at `messageId`, and carry on from there. Everything
   * after it in the tree stays: the next message becomes a sibling of what was
   * left behind, which is what makes a branch rather than an overwrite.
   *
   * The branch being shown is remembered in the thread row, because switching
   * writes no entry: pi keeps the position in the entry list, not beside it, and
   * the list is append-only — so without a note of our own, reopening would
   * stand at the last entry written, which is a different branch.
   */
  switchBranch(messageId: string): Promise<void>;
  /**
   * Take back `messageId`, so the next thing said replaces it: an edit, up to
   * the words. The replacement lands beside the message it replaces and both
   * stay in the tree, which is what makes an edit a branch rather than an
   * overwrite.
   *
   * Nothing is written to the thread row. Where this leaves the conversation is
   * pi's position, and the message that follows is the entry that records it —
   * until one arrives, the record still holds the branch that was there, which
   * is what it should hold.
   */
  editMessage(messageId: string): Promise<void>;
  /** Watch the turn as it runs. Returns an unsubscribe function. */
  subscribe(listener: (event: ChatEvent) => void): () => void;
  /** Whether Kira is writing in this chat right now. */
  isRunning(): boolean;
  /** The reply being written: one message's words, or null when there are none. */
  streaming(): string | null;
  /** Stop receiving events and dispose the session. */
  close(): void;
}

/**
 * pi's refusal to compact, said in Foundry's words.
 *
 * pi answers "Nothing to compact (session too small)" and "Already compacted",
 * and neither is a sentence for a person: no pi words cross the seam to the
 * window. Anything else it throws is a real failure — no model to run on, a
 * provider that cannot be reached — and is passed on as it stands, because
 * reading one of those as an empty chat would hide it.
 *
 * The two are recognised by pi's wording because that is all pi offers; a pi that
 * rewords them shows its own sentence instead, which reads worse than Foundry
 * would have put it but is not wrong.
 */
function compactionRefusal(failure: unknown): string {
  const said = failure instanceof Error ? failure.message : '';

  if (said.includes('Nothing to compact')) {
    return 'There is nothing in this chat to compact yet.';
  }

  if (said.includes('Already compacted')) {
    return 'This chat has had nothing added to it since it was last compacted.';
  }

  return said === '' ? 'This chat could not be compacted.' : said;
}

/** Continue the stored conversation `threadId`, and its working folder with it. */
export async function resumeConversation(
  store: ThreadStore,
  threadId: string,
  models: Models,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<Conversation> {
  return conversationOf(
    store,
    await resumeSession(
      store,
      threadId,
      models,
      memorySettings,
      tracker,
      mcp,
      prepareWorkspace,
      questionnaires,
    ),
    models,
    memorySettings,
  );
}

/** Start a new conversation, which works in `cwd`. */
export async function startConversation(
  store: ThreadStore,
  cwd: string,
  models: Models,
  options: {
    id?: string;
    workspaceId?: string;
    modelId?: string;
    ticketId?: string;
    mode?: ChatMode;
  } = {},
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<Conversation> {
  return conversationOf(
    store,
    await startSession(
      store,
      cwd,
      models,
      options,
      memorySettings,
      tracker,
      mcp,
      prepareWorkspace,
      questionnaires,
    ),
    models,
    memorySettings,
  );
}

/**
 * Start a conversation holding `threadId`'s words up to `messageId`: the same
 * conversation up to that point, from then on its own.
 */
export async function forkConversation(
  store: ThreadStore,
  sourceThreadId: string,
  messageId: string,
  models: Models,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<Conversation> {
  return conversationOf(
    store,
    await forkSession(
      store,
      sourceThreadId,
      messageId,
      models,
      memorySettings,
      tracker,
      mcp,
      prepareWorkspace,
      questionnaires,
    ),
    models,
    memorySettings,
  );
}

/**
 * A conversation around a booted session: its listeners, and its disposal.
 *
 * `memorySettings` is what this person decided about memory, read when it matters
 * rather than when the session booted, so that turning it off or choosing another
 * reflecting model takes effect in the chats already open. Nothing there is a
 * default of this module's: a machine that does not know what was decided runs as
 * the server's defaults do, which is memory on and the chat's own model.
 */
function conversationOf(
  store: ThreadStore,
  kira: KiraSession,
  models: Models,
  memorySettings?: MemorySource,
): Conversation {
  const listeners = new Set<(event: ChatEvent) => void>();
  const emit = (event: ChatEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  /**
   * The reply being written, as its words arrive: the message in flight, not the
   * turn. What has already ended is in the transcript, so keeping the whole turn
   * here would count it twice once a chat is read again mid-turn.
   */
  let writing: string | null = null;

  /**
   * What is waiting to be read, in the order she will read it: steering before
   * follow-ups, because that is the order pi delivers them in. pi holds the two
   * lanes as bare strings — a queue is only words so far, with no message of
   * their own — so each one is named here by when it will be read.
   */
  const lanes = (steering: readonly string[], followUp: readonly string[]): QueuedLine[] => [
    ...steering.map((text) => ({ lane: 'next' as const, text })),
    ...followUp.map((text) => ({ lane: 'later' as const, text })),
  ];
  const waiting = (): QueuedLine[] =>
    lanes(kira.session.getSteeringMessages(), kira.session.getFollowUpMessages());
  const takeBack = (): QueuedLine[] => {
    const { steering, followUp } = kira.session.clearQueue();

    return lanes(steering, followUp);
  };

  const unsubscribe = kira.session.subscribe((event) => {
    if (event.type === 'agent_start') {
      emit({ type: 'started', threadId: kira.threadId });
    }
    if (
      event.type === 'message_update' &&
      event.message.role === 'assistant' &&
      event.assistantMessageEvent.type !== 'text_delta' &&
      event.message.content.some((part) => part.type === 'thinking' || part.type === 'toolCall')
    ) {
      const live = transcriptOf(kira);
      const message = messageOf(
        {
          type: 'message',
          id: 'live-work',
          parentId: live.headId,
          timestamp: new Date().toISOString(),
          message: event.message,
        },
        live.headId,
        answersOf(kira.session.sessionManager.getEntries()),
      );
      emit({
        type: 'progress',
        threadId: kira.threadId,
        transcript:
          message === null
            ? live
            : { ...live, messages: [...live.messages, message], headId: message.id },
      });
    }
    // Words waiting their turn are not part of the transcript, and they move when
    // nothing else does: Kira reaching one takes it away, and someone steering
    // her mid-turn adds one. So the queue is pushed on its own rather than
    // waiting for the turn to end.
    if (event.type === 'queue_update') {
      emit({ type: 'queued', threadId: kira.threadId, queued: waiting() });
    }
    // Pi persists assistant messages and tool results as they happen. Publish
    // those entries immediately rather than waiting for the final turn snapshot,
    // so the renderer can draw the work that is already in the session.
    const completedAnswer =
      event.type === 'message_end' &&
      event.message.role === 'assistant' &&
      Array.isArray(event.message.content) &&
      event.message.content.some((part) => part.type === 'text' && part.text !== '');
    if (
      !completedAnswer &&
      (event.type === 'entry_appended' ||
        event.type === 'tool_execution_start' ||
        event.type === 'tool_execution_update' ||
        event.type === 'tool_execution_end' ||
        event.type === 'message_end')
    ) {
      emit({ type: 'progress', threadId: kira.threadId, transcript: transcriptOf(kira) });
    }
    // A message that has ended is in the transcript. Whatever is written next is
    // a message of its own, so nothing is in flight here any more — and the
    // window hears `beginsReply` on the next words rather than a reset now, so a
    // reply is never blanked a moment before the next one starts.
    if (event.type === 'message_end') {
      writing = null;
    }

    const delta = textDeltaOf(event);

    // An empty delta is not words: it would start a reply with nothing in it,
    // and the window would blank the line it is writing into to show that.
    if (delta !== undefined && delta !== '') {
      emit({
        type: 'delta',
        threadId: kira.threadId,
        text: delta,
        beginsReply: writing === null,
      });
      writing = (writing ?? '') + delta;
    }

    // pi settled the turn: everything it appended — including entries that
    // never streamed — is now in the database, so the window can be replaced
    // wholesale. This is what makes the transcript exact after a turn.
    if (event.type === 'agent_settled') {
      writing = null;
      // Before the transcript goes out: the window reads its whole state on
      // hearing it, so the memory that goes with these turns has to be written
      // down by the time it does.
      observe();
      emit({ type: 'transcript', threadId: kira.threadId, transcript: transcriptOf(kira) });
    }
  });

  /**
   * Work out what this chat has told Kira, and write it down.
   *
   * Read off the branch the conversation is on rather than the one it started on,
   * so a chat that changed its mind holds where it went rather than where it
   * began. Rebuilt whole each time, exactly as the summary is, so nothing is
   * carried from one pass to the next and nothing can drift.
   *
   * It is free. No model is called and no allowance is touched, because this is
   * the same extractors the compaction already runs — run as the chat happens
   * instead of at the end of it, which is what lets a decision outlive the turns
   * that produced it rather than only outlive the ones being discarded.
   *
   * And it cannot take the conversation down with it. What she is holding is
   * bookkeeping, and a chat whose ledger could not be written is a chat with a
   * stale ledger — the next pass recomputes the whole thing and picks up whatever
   * this one missed. The alternative is worse than stale: a throw here would
   * leave the window without the transcript it was about to be handed, and a
   * failed branch switch reported for a switch that worked.
   */
  const observe = (): void => {
    if (!memoryRuns(memorySettings)) return;

    try {
      const branch = turnsStoredIn(kira.session.sessionManager.getBranch());

      store.recordObservations(kira.threadId, observationsIn(branch, kira.cwd));
    } catch (error) {
      console.error('[foundry] what Kira was holding was not written down:', error);
    }
  };

  /**
   * Nothing is held to show while memory is off, because nothing is being held:
   * what is in the table is what earlier turns wrote, and a strip of it beside a
   * chat that is carrying none of it into its summaries would be a lie about what
   * Kira is working from.
   */
  const memory = (): ChatMemory[] =>
    memoryRuns(memorySettings) ? heldIn(store.loadObservations(kira.threadId)) : [];

  /**
   * Nothing worked out is shown while memory is off, for the reason nothing
   * noticed is: the reflector is not asked, so what is in the table was drawn
   * from turns this chat is no longer carrying into its summaries.
   */
  const conclusions = (): ChatConclusion[] =>
    memoryRuns(memorySettings) ? concludedIn(store.loadReflections(kira.threadId)) : [];

  // Once when the chat is opened, as well as after every turn. A chat that is
  // opened having been running before this build kept anything has a memory to
  // work out, and one reopened on a different branch is standing somewhere its
  // last answer did not describe.
  observe();

  return {
    threadId: kira.threadId,
    transcript: () => transcriptOf(kira),
    memory,
    conclusions,
    send: async (text) => {
      await prompting(kira, () => kira.session.prompt(text));
    },
    steer: async (text) => {
      // Both lanes fall back to saying it outright: a steer is only a steer while
      // something is being written, and pi's queues are drained by a turn that is
      // already running. Words typed a moment too late would otherwise wait for a
      // turn that never comes.
      if (kira.session.isStreaming) {
        await kira.session.steer(text);
        return;
      }

      await prompting(kira, () => kira.session.prompt(text));
    },
    followUp: async (text) => {
      if (kira.session.isStreaming) {
        await kira.session.followUp(text);
        return;
      }

      await prompting(kira, () => kira.session.prompt(text));
    },
    queued: waiting,
    takeQueuedBack: takeBack,
    stop: async () => {
      // The words waiting are taken back *before* the turn is stopped, not after.
      // pi drains its queue when a run ends — and stopping ends the run — so
      // anything still waiting would be delivered as a fresh turn rather than
      // handed back to be reworded. pi's own editor empties the queue first for
      // the same reason.
      const words = takeBack();

      await kira.session.abort();

      return words;
    },
    compact: async () => {
      try {
        await kira.session.compact();
      } catch (failure) {
        throw new Error(compactionRefusal(failure));
      }

      // A compaction makes no agent run, so nothing else tells the window the
      // chat has changed — pi's own settling event is what carries a transcript
      // after a turn, and no turn happened. Without this the boundary it just
      // wrote would not be drawn until something was said afterwards, which is
      // exactly what compacting by hand is for not waiting for.
      emit({ type: 'transcript', threadId: kira.threadId, transcript: transcriptOf(kira) });
    },
    switchBranch: async (messageId) => {
      // Refuse an id this chat does not hold a message at, in the same words a
      // fork does: the picker only ever sends message ids, so this is a window
      // out of step with the conversation rather than anything the tree said.
      if (kira.session.sessionManager.getEntry(messageId)?.type !== 'message') {
        throw missingMessage(messageId);
      }

      // pi moves its own position *and* rebuilds what the model sees, so the
      // next turn continues from this branch instead of the one left behind.
      // Without `summarize` this is bookkeeping, not a model call.
      const tip = branchTipOf(kira, messageId);
      await kira.session.navigateTree(tip);
      store.setHead(kira.threadId, tip);
      // The conversation is now on a different branch, so it is holding different
      // things: the turns it just stepped away from are not what it was told.
      // Free to redo, and the alternative is a memory describing a branch the
      // chat has left until something is said in the new one.
      observe();
    },
    editMessage: async (messageId) => {
      const entry = kira.session.sessionManager.getEntry(messageId);

      // Only words of your own are yours to change: pi reads a user message as
      // "stand before it", and for anything else the replacement would hang off
      // a reply instead of taking its place.
      if (entry?.type !== 'message' || entry.message.role !== 'user') {
        throw new Error('Only your own message can be changed.');
      }

      // A question that is the last thing said — what a turn that failed or was
      // stopped leaves behind — is already where this would stand, and pi counts
      // being there as nothing to do: the check comes before it turns a question
      // into "the question before it" (agent-session.js, navigateTree). The
      // replacement then follows the question instead of standing beside it.
      // Moving to the question's parent instead is not the answer, because a
      // parent that is another of your messages is a question too far back.
      // Revisit if pi offers a reset through navigation: SessionManager.resetLeaf
      // moves the leaf without rebuilding what the model is shown.
      await kira.session.navigateTree(messageId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isRunning: () => kira.session.isStreaming,
    modelId: () => kira.session.model?.id ?? null,
    chatUsage: () => {
      const full = kira.session.getContextUsage();

      return {
        spent: spentBy(kira.session.sessionManager.getEntries()),
        // pi answers null tokens in the gap a compaction leaves, and nothing at
        // all for a model with no window. Neither is a chat holding no context,
        // so neither is drawn as one.
        context:
          full === undefined || full.tokens === null
            ? null
            : { tokens: full.tokens, window: full.contextWindow },
      };
    },
    choose: async (modelId) => {
      const choice = await models.want(modelId);

      // Session-only: which model a chat runs on is the chat's business, and pi
      // would otherwise write it down as the default for every future session.
      await kira.session.setModel(choice.model);

      // Written down beside the entries as well, because this row is what a
      // session is booted with — pi's own record of it is inside the entry list,
      // and what it restores from there is deliberately not what this uses
      // (apps/desktop/src/main/pi/agent.ts).
      store.setThreadModel(kira.threadId, modelId);
    },
    setMode: async (mode) => {
      // The extension reads the persisted mode at the next turn boundary and
      // selects the matching tools before the model starts. The tool-call
      // guard reads it on every call as well, so changing the row is enough.
      store.setThreadMode(kira.threadId, mode);
    },
    setShellPath: (path) => kira.setShellPath(path),
    streaming: () => writing,
    close: () => {
      unsubscribe();
      listeners.clear();
      kira.dispose();
    },
  };
}

/**
 * Where pi has to stand for `messageId`'s branch to be the one on screen.
 *
 * pi reads a user message as "say that again": navigating to one stands *before*
 * the question and hands its words back, which is what makes the next question a
 * sibling of the old one. A branch picker is asking something else — show me
 * that exchange — so for a question we stand on its reply. Standing where pi
 * would would hide the very exchange that was picked, leaving the window with
 * less of the conversation than it had.
 */
function branchTipOf(kira: KiraSession, messageId: string): string {
  const entry = kira.session.sessionManager.getEntry(messageId);

  if (entry?.type !== 'message' || entry.message.role !== 'user') {
    return messageId;
  }

  const replies = kira.session.sessionManager
    .getChildren(messageId)
    .filter((child) => child.type === 'message' && child.message.role === 'assistant');

  // A question nothing has answered yet has no later message to stand on, and
  // standing on the question itself is what pi's own navigation does.
  return replies.at(-1)?.id ?? messageId;
}

/**
 * Every stored chat, the one with the most recent conversation activity first,
 * labelled with what the user first asked it.
 *
 * The label is derived from the transcript rather than stored beside it, so
 * there is one source of truth and no title column to migrate. The cost is
 * reading each thread's branch here; at the handful of chats a prototype has
 * that is nothing, and when a list gets long enough to feel it, a stored title
 * is the fix.
 */
export function listChats(store: ThreadStore): ChatSummary[] {
  return store.listThreads().map((thread) => ({
    id: thread.id,
    title: titleOf(turnsStoredIn(store.branchEntries(thread.id))),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    workspaceId: thread.workspaceId,
    ticketId: thread.ticketId,
  }));
}

/** Every workspace, the first one chosen first. */
export function listWorkspaces(store: ThreadStore): WorkspaceSummary[] {
  return store.listWorkspaces().map(workspaceSummaryOf);
}

/**
 * A workspace as the sidebar draws it.
 *
 * It is named after its folder rather than given a name of its own, so there is
 * nothing to keep in step with the directory. Two folders with the same last
 * part — two workspaces both called `api` — are told apart by where they are, not
 * by their name; showing the path is the fix if that ever matters.
 */
export function workspaceSummaryOf(workspace: WorkspaceRecord): WorkspaceSummary {
  return {
    id: workspace.id,
    name: basename(workspace.folder) || workspace.folder,
    folder: workspace.folder,
    projectId: workspace.projectId,
  };
}

/**
 * What a chat has cost, summed over everything in its session.
 *
 * Input and output only, which is how the allowance counts tokens
 * (docs/adr/0005-allowances.md) — the month's line and this one are read
 * together, so they have to be counting the same thing. What the provider cached
 * is left out for the same reason, and it is also the larger number: a turn that
 * reads a full context out of the cache reports thousands of cached tokens
 * against a few hundred of its own.
 *
 * Every entry counts, not only those on the branch on screen. Tokens spent on a
 * branch that was then left behind were still spent, and the month's ledger
 * holds them too.
 */
function spentBy(entries: readonly SessionEntry[]): number {
  let spent = 0;

  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;

    const usage = entry.message.usage;
    if (usage !== undefined) spent += usage.input + usage.output;
  }

  return spent;
}

/** Text as it is being written, or undefined when the event carries none. */
/**
 * Say the words, and say so when Kira could not answer them.
 *
 * pi answers a prompt that failed by ending the turn with an error rather than by
 * rejecting, so a turn whose provider refused would otherwise arrive as a reply
 * with nothing in it — which is the one thing a failure must not look like, since
 * it reads as Kira having nothing to say. What pi ended the turn with carries
 * why, and it is thrown so the window shows it where it shows every other
 * failure (docs/adr/0003-model-credentials.md).
 *
 * Only `error` counts. A turn the user stopped, and one that ran out of room,
 * both end differently, and neither is a failure to report.
 */
async function prompting(kira: KiraSession, words: () => Promise<void>): Promise<void> {
  await words();

  const last = kira.session.messages.at(-1);
  if (last?.role === 'assistant' && last.stopReason === 'error') {
    throw new Error(last.errorMessage ?? 'Kira could not answer that.');
  }
}

function textDeltaOf(event: AgentSessionEvent): string | undefined {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    return event.assistantMessageEvent.delta;
  }

  return undefined;
}

/**
 * The conversation as stored: every message in the tree, in the order it was
 * written, and the one pi currently stands at.
 *
 * The whole tree is sent rather than the visible branch, because the window
 * needs the messages it is *not* showing: they are the branches it offers to go
 * back to. `headId` is what says which one is on screen.
 */
function transcriptOf(kira: KiraSession): ChatTranscript {
  // pi's chain runs through entries that are not messages — model changes,
  // thinking levels, compaction. The window hears only about messages, so a
  // message's parent has to be the message above it: handing the runtime a
  // parent it was never given is a dangling link, and the runtime rejects the
  // whole tree rather than drawing it wrongly.
  const messageAbove = new Map<string, string | null>();
  const messages: ChatMessage[] = [];
  const entries = kira.session.sessionManager.getEntries();
  const answers = answersOf(entries);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  // A boundary stands above the message that carries on from it, and is found by
  // following pi's own parent links rather than by taking whatever message comes
  // next in the list: the transcript is a tree, so the entry written after a
  // compaction can belong to a branch the compaction never summarised. Each entry
  // inherits the boundaries standing above its parent, a compaction adds itself,
  // and the message it hands over to consumes them.
  const standingAbove = new Map<string, readonly ChatPart[]>();

  for (const entry of entries) {
    const parentId = nearestMessage(entry.parentId, messageAbove);
    const inherited = entry.parentId === null ? [] : (standingAbove.get(entry.parentId) ?? []);
    const boundary = compactionOf(entry, entryById);

    standingAbove.set(entry.id, boundary === null ? inherited : [...inherited, boundary]);

    const message = messageOf(entry, parentId, answers);

    if (message) {
      messages.push(
        inherited.length === 0 ? message : { ...message, parts: [...inherited, ...message.parts] },
      );
      // The message it was attached to has it now; a branch continuing from this
      // message is not above the boundary the boundary belongs to.
      standingAbove.set(entry.id, []);
    }

    messageAbove.set(entry.id, message?.id ?? parentId);
  }

  const branch = kira.session.sessionManager.getBranch();
  const onScreen = new Set(branch.map((entry) => entry.id));
  // The path from the first message to pi's position ends at the message the
  // reader is looking at, which is where a branch picker stands.
  const head = messages.filter((message) => onScreen.has(message.id)).at(-1);

  // A boundary is carried by the message it hands over to, so one that nothing
  // follows is still standing above where the walk left it. What stands above
  // pi's own position is therefore the end of the chat: compacting a chat and
  // saying nothing afterwards, which is what doing it by hand leaves behind.
  const leaf = branch.at(-1);

  return {
    messages,
    trailing: leaf === undefined ? [] : [...(standingAbove.get(leaf.id) ?? [])],
    headId: head?.id ?? null,
  };
}

/**
 * How many messages stand above `id` on its own branch.
 *
 * Walked up pi's parent links rather than counted along the whole entry list,
 * because the list holds every branch: a chat forked twice would otherwise count
 * the questions asked on the branch it is not showing.
 *
 * A compaction entry is transparent here — it is not a message, so the walk steps
 * over it and keeps counting, which is what makes the number the whole of what the
 * model no longer reads rather than only what this one compaction took.
 */
function messagesAbove(id: string, entryById: Map<string, SessionEntry>): number {
  let count = 0;
  let at = entryById.get(id)?.parentId ?? null;

  while (at !== null) {
    const entry = entryById.get(at);
    if (entry === undefined) break;

    if (entry.type === 'message') count += 1;
    at = entry.parentId;
  }

  return count;
}

/**
 * A stored compaction as the window's boundary, or nothing for any other entry.
 *
 * The count is taken from the entry pi kept rather than from the compaction's own
 * place, because the boundary is the line the chat is read across: everything
 * above the kept entry is what the summary stands in for. An entry pi names that
 * this chat no longer holds leaves the boundary counted from its own place, which
 * is the same answer for the first compaction a chat ever had.
 */
function compactionOf(
  entry: SessionEntry,
  entryById: Map<string, SessionEntry>,
): Extract<ChatPart, { type: 'compaction' }> | null {
  if (entry.type !== 'compaction') {
    return null;
  }

  const kept = entryById.has(entry.firstKeptEntryId) ? entry.firstKeptEntryId : entry.id;

  return {
    type: 'compaction',
    at: entry.timestamp,
    messages: messagesAbove(kept, entryById),
    lastWords: lastWordsIn(entry),
    reconstruction: entry.summary,
  };
}

/**
 * What the boundary leads with, as the compaction wrote it down, or null when it
 * wrote down nothing usable.
 *
 * Read structurally and checked rather than trusted: the entry is whatever an
 * earlier launch of this app put in the database, and a compaction pi wrote
 * itself — the fallback when Foundry's extension cannot answer — carries no
 * `details` at all. Either way the boundary gets a count and no quote, which it
 * can say, rather than a value of the wrong shape drawn as words.
 */
function lastWordsIn(entry: SessionEntry): string | null {
  const details = entry.type === 'compaction' ? entry.details : undefined;

  if (typeof details !== 'object' || details === null) return null;

  const said = (details as Partial<CompactionDetails>).lastWords;

  return typeof said === 'string' && said.trim() !== '' ? said : null;
}

/**
 * What each tool call answered — how it went, when it ended, what it came back
 * with, and what it changed — keyed by the call it answers. pi keeps a result as
 * an entry of its own, written after the reply that asked for it, so this is
 * read first and the transcript is then built in one pass knowing what every
 * call came to.
 */
function answersOf(entries: readonly FileEntry[]): Map<string, ToolAnswer> {
  const answers = new Map<string, ToolAnswer>();

  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') {
      continue;
    }

    const { toolCallId: callId, isError, details, content } = entry.message;
    const diff = diffOf(details);
    const said = textOf(content).trim();
    const images = imagesOf(content);

    answers.set(callId, {
      isError,
      glossaryChange: glossaryChangeIn(details),
      at: entry.timestamp,
      // A tool that changed a file returns a receipt naming the edit, and pi's
      // diff of it in the details beside that; the diff is the one a reader
      // opening the row is after, so it stands in for the receipt.
      output: diff ?? (said === '' ? null : said),
      ...(images.length === 0 ? {} : { images }),
      changes: diff === null ? null : countChanges(diff),
      proposal: proposalOf(details),
      map: mapProposalOf(details),
      decision: decisionProposalOf(details),
      outcome: outcomeProposalOf(details),
      breakdownProposal: breakdownProposalOf(details),
    });
  }

  return answers;
}

/** What one tool call came to: pi's own account of the run. */
interface ToolAnswer {
  isError: boolean;
  /** A server-owned glossary edit that the chat may offer to undo. */
  glossaryChange: GlossaryChangeNote | null;
  /** When the result was stored, which is what makes a call's duration. */
  at: string;
  /** What the tool returned: its output, or the change it made. */
  output: string | null;
  images?: ToolImage[];
  changes: { additions: number; deletions: number } | null;
  proposal: SpecProposal | undefined;
  map: MapProposal | undefined;
  decision: DecisionProposal | undefined;
  outcome: OutcomeProposal | undefined;
  breakdownProposal: BreakdownProposal | undefined;
}

/**
 * pi's own diff for a tool that changed a file, or nothing for one that did not.
 * The diff is the display one, where a changed line is prefixed with its sign and
 * the line number it landed on.
 */
function diffOf(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) {
    return null;
  }

  const { diff } = details as { diff?: unknown };

  return typeof diff === 'string' ? diff : null;
}

/** Details are validated before they become renderer-visible structured data. */
function breakdownProposalOf(details: unknown): BreakdownProposal | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const held = details as { kind?: unknown; proposal?: unknown };
  if (
    held.kind !== 'breakdown-proposal' ||
    typeof held.proposal !== 'object' ||
    held.proposal === null
  ) {
    return undefined;
  }
  const proposal = held.proposal as { id?: unknown; slices?: unknown };
  if (typeof proposal.id !== 'string' || !Array.isArray(proposal.slices)) return undefined;
  const slices: BreakdownSlice[] = [];
  for (const value of proposal.slices) {
    if (typeof value !== 'object' || value === null) return undefined;
    const slice = value as Partial<BreakdownSlice>;
    if (
      typeof slice.id !== 'string' ||
      typeof slice.kind !== 'string' ||
      typeof slice.title !== 'string' ||
      typeof slice.body !== 'string' ||
      !Array.isArray(slice.criteria) ||
      !slice.criteria.every((each) => typeof each === 'string') ||
      !Array.isArray(slice.dependsOn) ||
      !slice.dependsOn.every((each) => typeof each === 'string')
    )
      return undefined;
    slices.push(slice as BreakdownSlice);
  }
  return { id: proposal.id, chatId: '', slices, status: 'proposed', ticketIds: [] };
}

/** Details are validated before they become renderer-visible structured data. */
function proposalOf(details: unknown): SpecProposal | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const held = details as { kind?: unknown; proposal?: unknown };
  if (
    held.kind !== 'spec-proposal' ||
    typeof held.proposal !== 'object' ||
    held.proposal === null
  ) {
    return undefined;
  }
  const proposal = held.proposal as {
    id?: unknown;
    problem?: unknown;
    solution?: unknown;
    stories?: unknown;
    mapTicketId?: unknown;
  };
  if (
    typeof proposal.id !== 'string' ||
    typeof proposal.problem !== 'string' ||
    typeof proposal.solution !== 'string' ||
    !Array.isArray(proposal.stories) ||
    !proposal.stories.every((story) => typeof story === 'string')
  ) {
    return undefined;
  }
  return {
    id: proposal.id,
    chatId: '',
    problem: proposal.problem,
    solution: proposal.solution,
    stories: proposal.stories,
    // A spec that finishes an approved map carries the map, which its approval closes.
    ...(typeof proposal.mapTicketId === 'string' ? { mapTicketId: proposal.mapTicketId } : {}),
    status: 'proposed',
    ticketId: null,
  };
}

function mapProposalOf(details: unknown): MapProposal | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const held = details as { kind?: unknown; proposal?: unknown };
  if (held.kind !== 'map-proposal' || typeof held.proposal !== 'object' || held.proposal === null)
    return undefined;
  const proposal = held.proposal as {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    criteria?: unknown;
    questions?: unknown;
    research?: unknown;
  };
  const children = (value: unknown): MapProposal['questions'] | null => {
    if (!Array.isArray(value)) return null;
    const parsed = value.map((child) => {
      if (typeof child !== 'object' || child === null) return null;
      const item = child as { title?: unknown; body?: unknown; criteria?: unknown };
      return typeof item.title === 'string' &&
        typeof item.body === 'string' &&
        Array.isArray(item.criteria) &&
        item.criteria.every((criterion) => typeof criterion === 'string')
        ? { title: item.title, body: item.body, criteria: item.criteria }
        : null;
    });
    return parsed.some((child) => child === null) ? null : (parsed as MapProposal['questions']);
  };
  const questions = children(proposal.questions);
  const research = children(proposal.research);
  if (
    typeof proposal.id !== 'string' ||
    typeof proposal.title !== 'string' ||
    typeof proposal.body !== 'string' ||
    !Array.isArray(proposal.criteria) ||
    !proposal.criteria.every((criterion) => typeof criterion === 'string') ||
    questions === null ||
    research === null
  )
    return undefined;
  return {
    id: proposal.id,
    chatId: '',
    title: proposal.title,
    body: proposal.body,
    criteria: proposal.criteria,
    questions,
    research,
    status: 'proposed',
    ticketId: null,
  };
}

function outcomeProposalOf(details: unknown): OutcomeProposal | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const held = details as { kind?: unknown; proposal?: unknown };
  if (
    held.kind !== 'outcome-proposal' ||
    typeof held.proposal !== 'object' ||
    held.proposal === null
  ) {
    return undefined;
  }
  const proposal = held.proposal as {
    id?: unknown;
    ticketId?: unknown;
    answer?: unknown;
    sources?: unknown;
    decisionProposal?: unknown;
  };
  if (
    typeof proposal.id !== 'string' ||
    typeof proposal.ticketId !== 'string' ||
    typeof proposal.answer !== 'string' ||
    !Array.isArray(proposal.sources) ||
    !proposal.sources.every((source) => typeof source === 'string')
  )
    return undefined;
  return {
    id: proposal.id,
    chatId: '',
    ticketId: proposal.ticketId,
    answer: proposal.answer,
    sources: proposal.sources,
    decisionProposal: (proposal.decisionProposal ?? null) as OutcomeProposal['decisionProposal'],
    status: 'proposed',
    outcomeId: null,
  };
}

function decisionProposalOf(details: unknown): DecisionProposal | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const held = details as { kind?: unknown; proposal?: unknown };
  if (
    held.kind !== 'decision-proposal' ||
    typeof held.proposal !== 'object' ||
    held.proposal === null
  ) {
    return undefined;
  }
  const proposal = held.proposal as {
    id?: unknown;
    context?: unknown;
    choice?: unknown;
    rejectedOptions?: unknown;
    consequences?: unknown;
    supersedes?: unknown;
  };
  if (
    typeof proposal.id !== 'string' ||
    typeof proposal.context !== 'string' ||
    typeof proposal.choice !== 'string' ||
    !Array.isArray(proposal.rejectedOptions) ||
    !proposal.rejectedOptions.every((option) => typeof option === 'string') ||
    typeof proposal.consequences !== 'string' ||
    (proposal.supersedes !== null && typeof proposal.supersedes !== 'string')
  ) {
    return undefined;
  }
  return {
    id: proposal.id,
    chatId: '',
    context: proposal.context,
    choice: proposal.choice,
    rejectedOptions: proposal.rejectedOptions,
    consequences: proposal.consequences,
    supersedes: proposal.supersedes,
    status: 'proposed',
    decisionId: null,
  };
}

function glossaryChangeIn(details: unknown): GlossaryChangeNote | null {
  if (typeof details !== 'object' || details === null) return null;
  const held = details as Partial<GlossaryChangeNote>;
  if (
    typeof held.workspaceId !== 'string' ||
    typeof held.chatId !== 'string' ||
    typeof held.entryId !== 'string' ||
    !Number.isInteger(held.version) ||
    typeof held.term !== 'string'
  ) {
    return null;
  }
  return held as GlossaryChangeNote;
}

/** How many lines a diff added and removed, counted from pi's own diff of them. */
function countChanges(diff: string): ToolAnswer['changes'] {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  // A tool that changed no lines has nothing to count, and "+0 -0" beside a call
  // reads as a change that did not happen.
  return additions === 0 && deletions === 0 ? null : { additions, deletions };
}

/** The closest message at or above `entryId`: what a parent link has to name. */
function nearestMessage(
  entryId: string | null,
  messageAbove: Map<string, string | null>,
): string | null {
  return entryId === null ? null : (messageAbove.get(entryId) ?? null);
}

/**
 * One stored entry as a message, or nothing when it is not a turn's own words —
 * model changes, compaction summaries, thinking, tool results. An assistant
 * entry with no text and no tool calls is nothing to show either.
 */
function messageOf(
  entry: FileEntry,
  parentId: string | null,
  answers: Map<string, ToolAnswer>,
): ChatMessage | null {
  if (entry.type !== 'message') {
    return null;
  }

  const { id } = entry;
  const { message } = entry;

  if (message.role === 'user') {
    const text = typeof message.content === 'string' ? message.content : textOf(message.content);
    return text ? { id, parentId, role: 'you', parts: [{ type: 'text', text }] } : null;
  }

  if (message.role === 'assistant') {
    const parts: ChatPart[] = [];

    for (const part of message.content) {
      if (part.type === 'text') {
        if (part.text) {
          parts.push({ type: 'text', text: part.text });
        }

        continue;
      }

      if (part.type === 'thinking') {
        if (!part.thinking) {
          continue;
        }

        const last = parts.at(-1);

        // What she thinks joins the step it led to, rather than standing apart
        // from the tools it explains.
        if (last?.type === 'work') {
          last.reasoning = (last.reasoning ?? '') + part.thinking;
        } else {
          parts.push({ type: 'work', reasoning: part.thinking, durationMs: null, calls: [] });
        }

        continue;
      }

      if (part.type !== 'toolCall') {
        continue;
      }

      const answer = answers.get(part.id);
      const call = toolRun(part.name, part.arguments, entry.timestamp, answer);
      const last = parts.at(-1);

      // Tools she ran back to back are one step of her work, so they gather into
      // the run that is already open rather than starting another. The step's
      // own duration ends where its last tool did.
      if (last?.type === 'work') {
        last.calls.push(call);
        last.durationMs = call.durationMs;
      } else {
        parts.push({ type: 'work', reasoning: null, durationMs: call.durationMs, calls: [call] });
      }

      if (answer?.glossaryChange !== null && answer?.glossaryChange !== undefined) {
        parts.push({ type: 'glossary', change: answer.glossaryChange });
      }
    }

    return parts.length > 0 ? { id, parentId, role: 'kira', parts } : null;
  }

  return null;
}

/** Arguments pi's built-in tools name their target with: a path, a command, a pattern. */
const TOOL_TARGET_ARGUMENTS = ['path', 'command', 'pattern', 'term'] as const;

/** How a call ended, or that its result never came back. */
function statusOf(answer: ToolAnswer | undefined): ToolRun['status'] {
  if (answer === undefined) {
    return 'running';
  }

  return answer.isError ? 'error' : 'complete';
}

/**
 * A tool call as a part: what ran, what it acted on, what it produced, and how
 * it went. pi records a tool's result separately; a successful `write` only
 * returns a receipt, so its supplied file body is the useful output to show.
 */
function toolRun(
  name: string,
  args: Record<string, unknown>,
  askedAt: string,
  answer: ToolAnswer | undefined,
): ToolRun {
  const skillPath =
    name === 'read' && typeof args['path'] === 'string' && basename(args['path']) === 'SKILL.md'
      ? args['path']
      : null;
  const target = TOOL_TARGET_ARGUMENTS.map((argument) => args[argument]).find(
    (value): value is string => typeof value === 'string',
  );

  return {
    name: skillPath === null ? name : 'load_skill',
    target: skillPath === null ? (target ?? null) : basename(dirname(skillPath)),
    status: statusOf(answer),
    // A call with no result has no time either: nothing has ended yet. pi answers
    // an aborted tool as well as a finished one, so a missing result is a session
    // that stopped mid-call — a crash, or the window being killed.
    durationMs: answer === undefined ? null : Date.parse(answer.at) - Date.parse(askedAt),
    output: shownOutput(name, args, answer),
    ...(answer?.images === undefined ? {} : { images: answer.images }),
    additions: answer?.changes?.additions ?? null,
    deletions: answer?.changes?.deletions ?? null,
    ...(answer?.proposal === undefined ? {} : { proposal: answer.proposal }),
    ...(answer?.map === undefined ? {} : { map: answer.map }),
    ...(answer?.decision === undefined ? {} : { decision: answer.decision }),
    ...(answer?.outcome === undefined ? {} : { outcome: answer.outcome }),
    ...(answer?.breakdownProposal === undefined
      ? {}
      : { breakdownProposal: answer.breakdownProposal }),
  };
}

/**
 * What a reader can inspect after a tool finishes.
 *
 * Most tools put their real result in the tool-result entry. `write` is the
 * exception: its successful result only confirms the write, while `content` is
 * the complete file that now exists. Keep an error's diagnostic instead — a
 * failed write did not produce that file.
 */
function shownOutput(
  name: string,
  args: Record<string, unknown>,
  answer: ToolAnswer | undefined,
): string | null {
  if (
    name === 'write' &&
    answer !== undefined &&
    !answer.isError &&
    typeof args['content'] === 'string'
  ) {
    return args['content'];
  }

  return answer?.output ?? null;
}

/** Concatenate the text parts of a content list, ignoring images and thinking. */
function textOf(content: readonly { type: string }[]): string {
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Keep valid image parts for the renderer without making pi's content types public. */
function imagesOf(
  content: readonly { type: string; data?: unknown; mimeType?: unknown }[],
): ToolImage[] {
  return content.flatMap((part) =>
    part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string'
      ? [{ data: part.data, mimeType: part.mimeType }]
      : [],
  );
}

/**
 * Every kind of thing the observer notices, as the window names them.
 *
 * A record rather than a list so that adding a kind to `MemoryKind` fails to
 * compile until it is allowed through here, which is the whole job of this
 * filter: the table stores the kind as text and does not check it.
 */
const MEMORY_KINDS: Record<MemoryKind, true> = {
  goal: true,
  changed: true,
  read: true,
  commit: true,
  preference: true,
};

function isMemoryKind(value: string): value is MemoryKind {
  return value in MEMORY_KINDS;
}

/**
 * What the database holds, as the window reads it.
 *
 * The kind is what a panel groups by, so a row whose kind this build does not
 * know is left out rather than drawn under a heading nothing explains. That is
 * the only way it can arrive: the vocabulary is the observer's, and the table
 * deliberately does not enforce it.
 */
function heldIn(records: readonly ObservationRecord[]): ChatMemory[] {
  const memory: ChatMemory[] = [];

  for (const record of records) {
    if (!isMemoryKind(record.kind)) continue;

    memory.push({ kind: record.kind, at: record.at, text: record.text });
  }

  return memory;
}

/**
 * What she worked out, as the window reads it.
 *
 * The row's id stays behind: it is how the store keeps one conclusion from being
 * written twice, and what the pane reads is the order rather than the identity.
 */
function concludedIn(records: readonly StoredReflection[]): ChatConclusion[] {
  return records.map(({ text, coversThrough }) => ({ text, coversThrough }));
}
