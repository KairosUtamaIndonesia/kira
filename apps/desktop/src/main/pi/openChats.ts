/**
 * The chats that are open, and which one is on screen.
 *
 * Opening a chat does not close the one it was on. A chat is its own session, so
 * two of them can have Kira writing at the same time — switching is a change of
 * what is being read, not a change of what is running. That is the point of this
 * module: it owns the difference between *open* and *shown*, which is exactly
 * the difference between a turn that survives a click in the sidebar and one
 * that does not.
 *
 * A session is not free — provider connections, timers — so the ones that are
 * kept are the ones with a reason to be. A chat that is left is closed as soon
 * as it is not writing, and one that is writing is closed when its turn ends:
 * at most the chat on screen and the chats being written in stay open.
 *
 * A chat in the list is one that has been said something in. Starting one only
 * begins composing it, under the id it will keep, with nothing stored and nothing
 * in the list; the first message sent is what makes it a chat, and the id it was
 * composed under means the pane on screen is not swapped out from under it.
 *
 * Nothing is disposed of while Kira is writing in it, and that reaches past the
 * chat: the workspace a running chat is filed under stays too, because filing it
 * nowhere mid-turn would move the work out from under the answer. A chat being
 * written in is not put away or thrown away either, for the same reason: the
 * words in flight are that chat's.
 */
import { randomUUID } from 'node:crypto';
import type {
  ChatMode,
  ChatEvent,
  ChatState,
  Proposal,
  QueuedLine,
  ShapingState,
  Ticket,
} from '../../preload/bridge.ts';
import type { ThreadStore } from '../db/threads.ts';
import {
  type Conversation,
  forkConversation,
  listChats,
  listWorkspaces,
  resumeConversation,
  startConversation,
} from './conversations.ts';
import type { Models } from './models.ts';
import type { WorkspacePreparer } from './agent.ts';
import type { MemorySource } from '../memory.ts';
import type { TicketDraft } from '../../preload/bridge.ts';
import type { Tracker } from '../tracker.ts';
import {
  breakdownIn,
  decisionProposalIn,
  mapProposalIn,
  markdownFor,
  noShaping,
  outcomeProposalIn,
  proposalIn,
  shapingFrom,
  withProposal,
} from './extension/shaping.ts';
import type { McpManager } from '../mcp/servers.ts';
import type { Questionnaires } from '../questionnaires.ts';

/** The chats that are open, as the main process works with them. */
export interface OpenChats {
  /** Everything the window draws: the list, the chat on screen, the words in flight. */
  state(): ChatState;
  /** Apply a saved shell choice to every retained conversation. */
  setShellPath(path: string | undefined): Promise<void>;
  /**
   * The chat on screen — an open one, or a new one being composed — or null when
   * there is neither yet.
   */
  showing(): string | null;
  /** Send one message to the chat on screen and wait for the turn to finish. */
  send(text: string): Promise<void>;
  /** Change the current chat's mode, refusing a switch while Kira is writing. */
  setMode(mode: ChatMode): Promise<void>;
  /**
   * Approve a waiting proposal in the chat on screen, writing it through the
   * person-owned tracker seam. A breakdown is published and marked ready in one
   * step; when the server refuses readiness, the refusal is kept on the proposal
   * and the published tickets stay drafts.
   */
  approveProposal(proposalId: string): Promise<void>;
  /** Reject a waiting proposal in the chat on screen. Nothing reaches the tracker. */
  rejectProposal(proposalId: string): Promise<void>;
  /** Retry readiness on already-published drafts without publishing the breakdown again. */
  retryBreakdownReady(): Promise<void>;
  /** Send an Outcome back, retaining the same linked chat. */
  sendBackOutcome(proposalId: string): Promise<void>;
  /** Open or resume the one author-owned chat for a question. */
  startQuestion(workspaceId: string, ticketId: string): Promise<void>;
  /** Give Kira words to read at her next step, or once this turn has finished. */
  queue(text: string, lane: QueuedLine['lane']): Promise<void>;
  /** Take back the words still waiting in the chat on screen. */
  takeQueuedBack(): QueuedLine[];
  /**
   * Run the chat on screen on the model `modelId` names, from the next message
   * on. A chat still being composed has no session to switch, so its choice is
   * kept until it becomes one.
   */
  choose(modelId: string): Promise<void>;
  /**
   * Stop the reply being written in the chat on screen, and hand back the words
   * that were still waiting. What Kira has written so far stays.
   */
  stop(): Promise<QueuedLine[]>;
  /**
   * Summarise the chat on screen now rather than waiting for its window to fill,
   * so a chat can be tidied at a boundary of its reader's choosing.
   *
   * The chat being composed has nothing in it to summarise, and is refused in
   * the same words a sessionless chat is: there is no chat on screen to compact.
   */
  compact(): Promise<void>;
  /**
   * Begin a chat to compose in, filed under `workspaceId` when there is one.
   *
   * Nothing is stored and nothing joins the list: what this makes is a new chat
   * to compose in, which becomes a chat when its first message is sent. Nothing
   * lands on disk either, because where a new chat would work is worked out when
   * it becomes one.
   */
  start(workspaceId: string | null): Promise<void>;
  /**
   * Forget a workspace, leaving its chats, and the folder they work in, alone.
   *
   * A workspace with a chat being written in is not forgotten: the work is filed
   * under it, and there is nothing to take the filing out of while it runs.
   */
  removeWorkspace(id: string): Promise<void>;
  /**
   * Put a chat away: it leaves the list and keeps everything it holds, so it is
   * read again by its id, exactly as it was.
   *
   * A chat being written in is not put away. A chat on screen is left for the
   * most recent chat that is still in the list, or for a new chat to compose in
   * when that was the last one.
   */
  archiveChat(id: string): Promise<void>;
  /**
   * Bring a chat back from being put away: it rejoins the list exactly where
   * its last activity puts it, because being put away never touched that.
   */
  restoreChat(id: string): Promise<void>;
  /**
   * Throw a chat away: the row and every entry under it, and its session with
   * them.
   *
   * The folder it worked in is left as it is — a chat is what was said, and a
   * folder is what someone put there — and so is a chat forked from it, which
   * keeps its own words and only forgets where it came from.
   */
  deleteChat(id: string): Promise<void>;
  /** Show the stored chat `threadId`, opening it if it is not already open. */
  open(threadId: string): Promise<void>;
  /**
   * Take over a chat that somebody else started.
   *
   * A run's chat is begun by the main process, because a run has to go on whether or not
   * anybody is looking at it. Handing it here is what makes the window able to open the
   * row and steer the run that is *already going*, rather than resuming a second session
   * onto the same thread and leaving two of them writing in one chat.
   */
  adopt(conversation: Conversation): void;
  /** Show the branch ending at `messageId`, and carry on from there. */
  branch(messageId: string): Promise<void>;
  /** Take back `messageId` in the chat on screen, so it can be said differently. */
  edit(messageId: string): Promise<void>;
  /** Start a chat holding this one's words up to `messageId`, and show it. */
  fork(messageId: string): Promise<void>;
  /** Dispose every session. The window is gone, or going. */
  closeAll(): void;
}

/**
 * A new chat that has not been said anything in yet.
 *
 * It has an id — the id the chat will have — but nothing is stored for it, and
 * the chat list does not hold it: a chat begins when words are sent, not when a
 * box is opened. The id is picked now rather than at that moment so the window
 * can compose under an identity that does not change under its words.
 */
interface Draft {
  id: string;
  /** The workspace it was asked for, or null when it was filed nowhere. */
  workspaceId: string | null;
  /** The planning/build choice made before the first message is sent. */
  mode: ChatMode;
  /**
   * The model it was chosen to run on, or null when nobody chose one for it.
   *
   * A chat being composed has no session to switch, so this is held here until
   * there is one: the choice is the chat's, and the chat does not exist yet.
   */
  modelId: string | null;
}

/**
 * `publish` is told about every turn in every open chat, so a chat that is not
 * on screen still reaches the window: the sidebar is where a background turn is
 * seen, and the window reads the chat itself when it is opened.
 *
 * `newWorkspace` is where a chat filed nowhere works. It is asked for when such a
 * chat is made, not when the box for one is opened: a new chat that is never
 * sent leaves nothing behind, and a folder is something.
 */
export function openChats(
  store: ThreadStore,
  publish: (event: ChatEvent) => void,
  newWorkspace: () => string,
  models: Models,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): OpenChats {
  const open = new Map<string, Conversation>();
  const shaping = new Map<string, ShapingState>();
  let shown: string | null = null;
  let draft: Draft | null = null;

  function shapingFor(threadId: string): ShapingState {
    const held = shaping.get(threadId);
    if (held !== undefined) return held;

    // Nothing is written back here: a chat stored before the one list keeps its
    // stored slots until something it holds actually changes.
    const state = shapingFrom(store.getThread(threadId).shaping);
    shaping.set(threadId, state);
    return state;
  }

  function setShaping(threadId: string, next: ShapingState): void {
    shaping.set(threadId, next);
    store.setThreadShaping(threadId, next);
    publish({ type: 'shaping', threadId, shaping: next });
  }

  /** Put `next` in the place of the proposal `id` names, in the chat's current state. */
  function settle(threadId: string, id: string, next: Proposal): void {
    const held = shapingFor(threadId);
    setShaping(threadId, {
      ...held,
      proposals: held.proposals.map((each) => (each.id === id ? next : each)),
    });
  }

  /** The proposal `id` names in this chat, provided it is still waiting for a person. */
  function waiting(threadId: string, id: string): Proposal {
    const proposal = shapingFor(threadId).proposals.find((each) => each.id === id);
    if (proposal === undefined) throw new Error('That proposal is not in this chat.');
    if (proposal.status !== 'proposed') {
      throw new Error('That proposal is no longer waiting for a decision.');
    }
    return proposal;
  }

  /** The spec a person approved last in this chat, which its breakdown and runs hang from. */
  function approvedSpecTicket(state: ShapingState): string | null {
    const spec = state.proposals.findLast(
      (each) => each.kind === 'spec' && each.status === 'approved',
    );
    return spec?.kind === 'spec' ? spec.ticketId : null;
  }

  /** The latest proposal of each kind Kira has made in this transcript. */
  function proposalsInTranscript(
    threadId: string,
    transcript: ChatState['transcript'],
  ): Proposal[] {
    const latest = new Map<Proposal['kind'], Proposal>();
    for (const message of transcript.messages) {
      for (const part of message.parts) {
        if (part.type !== 'work') continue;
        for (const call of part.calls) {
          const spec = call.proposal && proposalIn(call.proposal, threadId);
          if (spec) latest.set('spec', { kind: 'spec', ...spec });
          const map = call.map && mapProposalIn(call.map, threadId);
          if (map) latest.set('map', { kind: 'map', ...map });
          const decision = call.decision && decisionProposalIn(call.decision, threadId);
          if (decision) latest.set('decision', { kind: 'decision', ...decision });
          const outcome = call.outcome && outcomeProposalIn(call.outcome, threadId);
          if (outcome) {
            latest.set('outcome', { kind: 'outcome', ...outcome });
            // An Outcome may suggest a Decision; it is proposed on its own, so
            // approving the Outcome never approves the Decision with it.
            const suggested =
              outcome.decisionProposal &&
              decisionProposalIn(
                { ...outcome.decisionProposal, id: `${outcome.id}:decision` },
                threadId,
              );
            if (suggested) latest.set('decision', { kind: 'decision', ...suggested });
          }
          const breakdown = call.breakdownProposal && breakdownIn(call.breakdownProposal, threadId);
          if (breakdown)
            latest.set('breakdown', { kind: 'breakdown', ...breakdown, readyRefusal: null });
        }
      }
    }
    return [...latest.values()];
  }

  /** Watch a conversation while it is open. */
  function keep(conversation: Conversation): Conversation {
    open.set(conversation.threadId, conversation);
    conversation.subscribe((event) => {
      if (event.type === 'transcript') {
        const current = shapingFor(conversation.threadId);
        // A proposal already in the list is the one it was: only one this chat has
        // not seen joins, and it replaces the waiting proposal of its kind.
        const proposals = proposalsInTranscript(conversation.threadId, event.transcript).reduce(
          (list, proposal) =>
            list.some((each) => each.id === proposal.id) ? list : withProposal(list, proposal),
          current.proposals,
        );
        if (proposals !== current.proposals) {
          setShaping(conversation.threadId, { ...current, proposals });
        }
      }
      publish(event);
    });

    return conversation;
  }

  /** Dispose a session and stop watching it. */
  function close(conversation: Conversation): void {
    open.delete(conversation.threadId);
    conversation.close();
  }

  /**
   * Let go of a chat that is off screen. Closing one while Kira is writing would
   * kill the turn, so a chat that is writing waits: its `send` closes it when the
   * turn is over.
   */
  function release(conversation: Conversation): void {
    if (conversation.threadId !== shown && !conversation.isRunning()) {
      close(conversation);
    }
  }

  /** Put an open conversation on screen, letting the chat it replaces go. */
  function show(conversation: Conversation): void {
    const left = shown === null ? undefined : open.get(shown);
    shown = conversation.threadId;

    if (left && left !== conversation) {
      release(left);
    }
  }

  function current(): Conversation {
    const conversation = shown === null ? undefined : open.get(shown);

    if (!conversation) {
      throw new Error('No chat is open.');
    }

    return conversation;
  }

  /**
   * Where a new chat works, and what it is filed under: the workspace it was asked
   * for when that workspace is still there, and otherwise a workspace of its own.
   *
   * A workspace can be forgotten while a chat is being composed for it — nothing is
   * running, so nothing stops it — and that chat is then filed nowhere, which is
   * what forgetting a workspace does to the chats it already had.
   */
  function filingOf(composing: Draft): {
    folder: string;
    workspaceId?: string;
  } {
    const workspace =
      composing.workspaceId === null ? undefined : store.findWorkspace(composing.workspaceId);

    return workspace
      ? { folder: workspace.folder, workspaceId: workspace.id }
      : { folder: newWorkspace() };
  }

  /**
   * The chat the words are said in, starting it first when they are what make it
   * a chat.
   *
   * The id the new chat was composed under is the id it keeps, so nothing the
   * window is showing has to change for words to arrive in it — a reply streams
   * into the same pane the question was written in.
   */
  async function currentForSend(): Promise<Conversation> {
    if (shown === null && draft !== null) {
      const composing = draft;
      const filing = filingOf(composing);
      draft = null;
      show(
        keep(
          await startConversation(
            store,
            filing.folder,
            models,
            {
              id: composing.id,
              workspaceId: filing.workspaceId,
              // The model chosen for a chat being composed, which had no session to
              // switch while it was being composed.
              ...(composing.modelId === null ? {} : { modelId: composing.modelId }),
              mode: composing.mode,
            },
            memorySettings,
            tracker,
            mcp,
            prepareWorkspace,
            questionnaires,
          ),
        ),
      );
    }

    return current();
  }

  /**
   * Refuse to touch a chat Kira is writing in. Its session is open and the words
   * in flight are the chat's, so putting it away or throwing it away is refused
   * while the turn runs.
   */
  function whileIdle(id: string): void {
    if (open.get(id)?.isRunning()) {
      throw new Error('Kira is writing in this chat.');
    }
  }

  /**
   * Begin a chat to compose in, under the id it will keep.
   *
   * A new chat is one new chat: asking for one again returns to the one being
   * composed, with its words, rather than starting a second. Where it will work
   * is whatever was asked for last — including nowhere in particular, when New
   * chat was pressed after New chat here.
   */
  function begin(workspaceId: string | null): void {
    const left = shown === null ? undefined : open.get(shown);

    // A new chat starts on the model the one being left runs on. The choice is
    // still the chat's — this binds the new chat to nothing — but starting back
    // at the pool's preference would mean picking the same model again every
    // time a new chat is begun, which is not what picking it meant.
    const modelId = left?.modelId() ?? null;

    draft = draft
      ? { ...draft, workspaceId }
      : { id: randomUUID(), workspaceId, modelId, mode: 'build' };
    shown = null;

    if (left) {
      release(left);
    }
  }

  /** Show a stored chat, opening it if it is not already open. */
  async function showStored(threadId: string): Promise<void> {
    const already = open.get(threadId);

    if (already) {
      show(already);
      return;
    }

    show(
      keep(
        await resumeConversation(
          store,
          threadId,
          models,
          memorySettings,
          tracker,
          mcp,
          prepareWorkspace,
          questionnaires,
        ),
      ),
    );
  }

  /**
   * Leave a chat that is no longer in the list: the window is drawing something
   * that is not there any more, so it is given the most recent chat that is —
   * or a new chat to compose in, when that was the last one.
   */
  async function leaveIfShown(id: string): Promise<void> {
    if (shown !== id) {
      return;
    }

    const recent = store.listThreads()[0]?.id;

    if (recent === undefined) {
      begin(null);
      return;
    }

    await showStored(recent);
  }

  return {
    state: () => {
      const conversation = shown === null ? null : current();
      const id = conversation?.threadId ?? draft?.id;

      if (id === undefined) {
        throw new Error('No chat is open.');
      }

      return {
        chats: listChats(store),
        workspaces: listWorkspaces(store),
        currentId: id,
        mode: conversation === null ? (draft?.mode ?? 'build') : store.getThread(id).mode,
        draftId: draft?.id ?? null,
        transcript: conversation?.transcript() ?? {
          messages: [],
          trailing: [],
          headId: null,
        },
        memory: conversation?.memory() ?? [],
        conclusions: conversation?.conclusions() ?? [],
        running: [...open.values()].filter((each) => each.isRunning()).map((each) => each.threadId),
        streaming: conversation?.streaming() ?? null,
        queued: conversation?.queued() ?? [],
        // What the chat is actually running on rather than what is written down
        // for it: a model the pool has stopped offering is replaced by what it
        // prefers, and a picker showing the written-down one would be naming a
        // model the chat is not using. A chat still being composed has no
        // session yet, so it shows the choice kept for it.
        modelId: conversation?.modelId() ?? draft?.modelId ?? null,
        // Nothing, for a chat being composed: there is no session to have spent
        // anything or filled anything yet.
        chatUsage: conversation?.chatUsage() ?? null,
        shaping: conversation === null ? noShaping() : shapingFor(conversation.threadId),
        questionnaire:
          conversation === null || questionnaires === undefined
            ? null
            : questionnaires.current(conversation.threadId),
      };
    },

    setShellPath: async (path) => {
      await Promise.all([...open.values()].map((conversation) => conversation.setShellPath(path)));
    },

    // A new chat that is being composed is on screen as much as an open one: a
    // window that finds this null has nothing to draw either way.
    showing: () => shown ?? draft?.id ?? null,

    send: async (text) => {
      const conversation = await currentForSend();

      try {
        await conversation.send(text);
      } finally {
        // The turn is over, so a chat that was left while Kira was writing is
        // done and can be released.
        release(conversation);
      }
    },
    setMode: async (mode) => {
      if (shown === null && draft !== null) {
        draft = { ...draft, mode };
        return;
      }

      const conversation = current();
      if (conversation.isRunning()) {
        throw new Error('Wait for Kira to finish before changing chat mode.');
      }
      await conversation.setMode(mode);
    },

    approveProposal: async (proposalId) => {
      const conversation = current();
      const threadId = conversation.threadId;
      const proposal = waiting(threadId, proposalId);
      if (tracker === undefined) throw new Error('The tracker is unavailable.');
      const workspaceId = store.getThread(threadId).workspaceId;
      if (workspaceId === null) throw new Error('This chat is not filed in a project workspace.');

      switch (proposal.kind) {
        case 'spec': {
          const draft: TicketDraft = {
            kind: 'spec',
            title: proposal.problem.split(/[.!?]/u)[0]?.trim() || 'Proposed spec',
            body: markdownFor(proposal),
            criteria: proposal.stories,
            sourceChatId: threadId,
          };
          // A destination is different from an ordinary spec only in its parent
          // transition: the server creates the child and closes the map atomically.
          let destination: Ticket | undefined;
          if (proposal.mapTicketId !== null && proposal.mapTicketId !== undefined) {
            if (tracker.approveDestinationSpec === undefined)
              throw new Error('Map destination approval is unavailable.');
            destination = await tracker.approveDestinationSpec(
              workspaceId,
              proposal.mapTicketId,
              draft,
            );
          }
          const ticket = destination ?? (await tracker.write(workspaceId, draft));
          // Ordinary specs follow #90. Destination specs are already ready in the
          // same server transaction, so changing them again would break atomicity.
          const blocked =
            destination === undefined
              ? await tracker.change(ticket.id, { gate: 'ready-for-agent' })
              : ticket;
          settle(threadId, proposal.id, { ...proposal, status: 'approved', ticketId: blocked.id });
          await conversation.send(
            'The person approved the spec proposal. Foundry recorded it. Immediately propose its ticket breakdown with shape_breakdown_proposal. Do not publish the tickets; wait for the person to approve the breakdown.',
          );
          return;
        }
        case 'map': {
          if (tracker.createMap === undefined) throw new Error('Map approval is unavailable.');
          const { kind: _map, ...map } = proposal;
          const ticket = await tracker.createMap(workspaceId, map, threadId);
          settle(threadId, proposal.id, { ...proposal, status: 'approved', ticketId: ticket.id });
          await conversation.send('The person approved the map proposal. Foundry recorded it.');
          return;
        }
        case 'decision': {
          const { kind: _decision, ...decision } = proposal;
          await tracker.approveDecision(workspaceId, decision, threadId);
          settle(threadId, proposal.id, {
            ...proposal,
            status: 'approved',
            decisionId: proposal.id,
          });
          await conversation.send(
            'The person approved the Decision proposal. Foundry recorded it.',
          );
          return;
        }
        case 'outcome': {
          const outcome = await tracker.approveOutcome(workspaceId, proposal.ticketId, {
            answer: proposal.answer,
            sources: proposal.sources,
            sourceChatId: threadId,
            ...(proposal.decisionProposal === null
              ? {}
              : { decisionProposal: proposal.decisionProposal }),
          });
          settle(threadId, proposal.id, { ...proposal, status: 'approved', outcomeId: outcome.id });
          await conversation.send('The person approved the Outcome proposal. Foundry recorded it.');
          return;
        }
        case 'breakdown': {
          const specTicketId = approvedSpecTicket(shapingFor(threadId));
          if (specTicketId === null) {
            throw new Error('Approve the spec before approving its breakdown.');
          }
          const published = await tracker.publishBreakdown(specTicketId, proposal.slices);
          // Publishing is not undone when readiness is refused: the tickets stay
          // drafts, and the server's words stay on the proposal for the person.
          let readyRefusal: string | null = null;
          try {
            await tracker.markBreakdownReady(specTicketId);
          } catch (failure) {
            readyRefusal = failure instanceof Error ? failure.message : String(failure);
          }
          settle(threadId, proposal.id, {
            ...proposal,
            status: 'approved',
            ticketIds: published.children.map((child) => child.id),
            readyRefusal,
          });
          await conversation.send(
            readyRefusal === null
              ? 'The person approved the breakdown. Foundry published the tickets and marked them ready.'
              : `The person approved the breakdown. Foundry published the drafts but refused readiness: ${readyRefusal}`,
          );
          return;
        }
      }
    },

    rejectProposal: async (proposalId) => {
      const conversation = current();
      const proposal = waiting(conversation.threadId, proposalId);
      settle(conversation.threadId, proposal.id, { ...proposal, status: 'rejected' });
      await conversation.send(`The person rejected the ${proposal.kind} proposal.`);
    },

    retryBreakdownReady: async () => {
      const conversation = current();
      const held = shapingFor(conversation.threadId);
      const proposal = held.proposals.findLast(
        (each) =>
          each.kind === 'breakdown' && each.status === 'approved' && each.ticketIds.length > 0,
      );
      if (
        proposal === undefined ||
        proposal.kind !== 'breakdown' ||
        proposal.readyRefusal === null
      ) {
        throw new Error('There is no published breakdown waiting for a readiness retry.');
      }
      const specTicketId = approvedSpecTicket(held);
      if (specTicketId === null) throw new Error('Approve the spec before readying its breakdown.');
      if (tracker === undefined) throw new Error('The tracker is unavailable.');
      try {
        await tracker.markBreakdownReady(specTicketId);
        settle(conversation.threadId, proposal.id, { ...proposal, readyRefusal: null });
      } catch (failure) {
        const refusal = failure instanceof Error ? failure.message : String(failure);
        settle(conversation.threadId, proposal.id, { ...proposal, readyRefusal: refusal });
        throw failure;
      }
    },

    sendBackOutcome: async (proposalId) => {
      const conversation = current();
      const proposal = waiting(conversation.threadId, proposalId);
      if (proposal.kind !== 'outcome') throw new Error('Only an Outcome can be sent back.');
      settle(conversation.threadId, proposal.id, { ...proposal, status: 'replaced' });
      // The Decision this Outcome suggested goes back with it.
      const suggested = shapingFor(conversation.threadId).proposals.find(
        (each) => each.id === `${proposal.id}:decision` && each.status === 'proposed',
      );
      if (suggested !== undefined) {
        settle(conversation.threadId, suggested.id, { ...suggested, status: 'replaced' });
      }
      await conversation.send(
        'The person sent this Outcome back. Keep this same question chat and revise the answer with supporting sources.',
      );
    },

    startQuestion: async (workspaceId, ticketId) => {
      if (tracker === undefined) throw new Error('The tracker is unavailable.');
      const workspace = store.findWorkspace(workspaceId);
      if (workspace === undefined) throw new Error('That workspace is no longer open.');
      const ticket = await tracker.openQuestion(workspaceId, ticketId, randomUUID());
      const chatId = ticket.sourceChatId;
      if (chatId === null || chatId === undefined)
        throw new Error('The question has no linked chat.');
      if (store.findThread(chatId) !== undefined) {
        await showStored(chatId);
        return;
      }
      show(
        keep(
          await startConversation(
            store,
            workspace.folder,
            models,
            { id: chatId, workspaceId, ticketId },
            memorySettings,
            tracker,
            mcp,
            prepareWorkspace,
            questionnaires,
          ),
        ),
      );
    },

    queue: async (text, lane) => {
      const conversation = current();

      if (lane === 'next') {
        await conversation.steer(text);
        return;
      }

      await conversation.followUp(text);
    },

    takeQueuedBack: () => current().takeQueuedBack(),

    stop: async () => await current().stop(),

    /**
     * Summarise the chat on screen now, which is what a person asking for it
     * means: the boundary lands where they are reading rather than where pi would
     * have put it, and the chat carries on from there.
     */
    compact: async () => await current().compact(),

    start: async (workspaceId) => begin(workspaceId),

    choose: async (modelId) => {
      // A chat being composed is not open yet, so there is no session to switch:
      // the choice waits for the session it will have. Checked against the
      // catalog all the same — the window reads the list once, so it can name a
      // model the pool has dropped since, and a chat that quietly ran on
      // something else would be worse than one that refused.
      if (shown === null && draft !== null) {
        await models.want(modelId);

        draft = { ...draft, modelId };
        return;
      }

      await current().choose(modelId);
    },

    removeWorkspace: async (id) => {
      // A chat being written in is filed under its workspace, and that filing is not
      // pulled out from under a turn: the workspace waits until the writing stops.
      const writing = [...open.values()].some(
        (each) => each.isRunning() && store.getThread(each.threadId).workspaceId === id,
      );

      if (writing) {
        throw new Error('Kira is writing in one of this workspace’s chats.');
      }

      await mcp?.forgetWorkspace(id);
      store.forgetWorkspace(id);
    },

    archiveChat: async (id) => {
      whileIdle(id);
      store.archiveThread(id);
      await leaveIfShown(id);
    },

    // Nothing here needs `whileIdle` or `leaveIfShown`: a chat only reaches
    // this once it is already out of the list and idle, and bringing it back
    // never moves what a window is showing.
    restoreChat: async (id) => {
      store.unarchiveThread(id);
    },

    deleteChat: async (id) => {
      whileIdle(id);
      const conversation = open.get(id);

      store.deleteThread(id);

      // The chat is gone, so its session goes with it: there is nothing left to
      // write into, and a window that went on drawing it would be drawing a
      // chat the database no longer holds.
      if (conversation) {
        close(conversation);
      }

      await leaveIfShown(id);
    },

    open: (threadId) => showStored(threadId),

    adopt: (conversation) => keep(conversation),

    branch: (messageId) => current().switchBranch(messageId),

    edit: (messageId) => current().editMessage(messageId),

    fork: async (messageId) => {
      const source = current();
      show(
        keep(
          await forkConversation(
            store,
            source.threadId,
            messageId,
            models,
            memorySettings,
            tracker,
            mcp,
            prepareWorkspace,
            questionnaires,
          ),
        ),
      );
    },

    closeAll: () => {
      questionnaires?.closeAll();
      for (const conversation of open.values()) {
        conversation.close();
      }

      open.clear();
      shown = null;
      draft = null;
    },
  };
}
