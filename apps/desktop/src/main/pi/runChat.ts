/**
 * A run's chat.
 *
 * A run is not a job with a log: it is a conversation with a ticket behind it, and the
 * person who started it can open it, read it, and say something to it while it goes
 * (docs/adr/0012). So what this makes is an ordinary chat — the same `Conversation` the
 * window shows, filed under the project's workspace, working in the run's own checkout —
 * and what it adds is only what is particular to a run: what it is told to begin with,
 * what it has said since anybody last looked, and how to let it go without losing a word.
 *
 * The chat is handed to `adopt` so that exactly one session is ever writing in it. The
 * window opens the same conversation the run is going in and steers *that*, rather than
 * resuming a second session onto the same thread — which is the whole difference between
 * being able to steer a run and being able to read a copy of it that has stopped.
 *
 * Watching is a choice. Nothing here waits to be looked at: the turn goes on when nobody
 * is looking, and the row is one line in a list.
 */
import type { ChatMessage, ChatTranscript, Ticket, TicketKind } from '../../preload/bridge.ts';
import type { ThreadStore } from '../db/threads.ts';
import type { MemorySource } from '../memory.ts';
import type { RunContext, Tracker } from '../tracker.ts';
import type { WorkspacePreparer } from './agent.ts';
import { startConversation, type Conversation } from './conversations.ts';
import type { Models } from './models.ts';
import type { McpManager } from '../mcp/servers.ts';
import type { Questionnaires } from '../questionnaires.ts';

/** One thing said in a run, ready to be kept on the ticket. */
export interface RunLine {
  saidBy: 'person' | 'agent';
  words: string;
}

export interface RunChat {
  readonly threadId: string;
  /**
   * Set it going on the ticket, and resolve when it has stopped writing.
   *
   * Rejects when the turn fell over, which is a run that ended badly rather than a
   * failure of this module: the keeper writes down why.
   */
  begin(branch: string, resolutionReason?: string): Promise<void>;
  /**
   * Hear every line as it becomes settled. Returns a way to stop hearing them.
   *
   * A person's line is settled the moment it is said, so it arrives at once. An agent's
   * arrives only when nothing is being written: a reply comes in pieces, and half a
   * sentence kept on a ticket is worse than none of it.
   */
  onLine(listener: (line: RunLine) => void): () => void;
  /** The shell commands it ran, in the order it first ran them. */
  ran(): string[];
  /** Let it go: the row leaves the list, and its words stay on the ticket. */
  close(): void;
}

export const MAP_RUN_REFUSAL = 'Map tickets are planning records and cannot be run.';

const EMPTY_CONTEXT: RunContext = {
  spec: null,
  siblings: [],
  glossary: [],
  decisions: [],
};

/**
 * Start a chat for a run and hand it to the window.
 *
 * `id` is chosen by the caller rather than here so that the run and its chat have one
 * name between them: what the keeper writes to the ticket and what the row in the sidebar
 * is called are the same thing.
 */
export async function startRunChat({
  store,
  models,
  memory,
  ticket,
  workspaceId,
  folder,
  id,
  adopt,
  tracker,
  mcp,
  questionnaires,
  prepareWorkspace,
}: {
  store: ThreadStore;
  models: Models;
  memory?: MemorySource;
  mcp?: McpManager;
  questionnaires?: Questionnaires;
  prepareWorkspace?: WorkspacePreparer;
  ticket: Ticket;
  workspaceId: string | null;
  folder: string;
  id: string;
  adopt: (conversation: Conversation) => void;
  tracker?: Tracker;
}): Promise<RunChat> {
  if (ticket.kind === 'map') throw new Error(MAP_RUN_REFUSAL);

  // Read the current queue and project knowledge through the main-process capability before
  // opening the run chat. This is deliberately not copied from the Work surface: a ticket,
  // its siblings and its project knowledge may have changed since the person pressed Run.
  const context =
    tracker === undefined || workspaceId === null
      ? EMPTY_CONTEXT
      : await tracker.runContext(workspaceId, ticket.id);

  // The ticket's earlier runs are over, and every one of their rows would carry the same
  // name as this one — four runs are four rows called after one ticket. What a person reads
  // from an older run is on the ticket rather than in the row, so the window keeps the
  // newest run's chat and clears the ones it replaces (GH #68).
  for (const earlier of ticket.runs) store.deleteThread(earlier.id);

  const conversation = await startConversation(
    store,
    folder,
    models,
    { id, ticketId: ticket.id, ...(workspaceId === null ? {} : { workspaceId }) },
    memory,
    tracker,
    mcp,
    prepareWorkspace,
    questionnaires,
  );
  adopt(conversation);

  const handedOver = new Set<string>();
  const listeners = new Set<(line: RunLine) => void>();

  /** Everything it has said that nobody has been told about yet. */
  function settle(): void {
    const lines = linesIn(conversation.transcript(), handedOver, conversation.isRunning());

    for (const line of lines) {
      for (const listener of listeners) listener(line);
    }
  }

  const stopHearing = conversation.subscribe(settle);

  return {
    threadId: conversation.threadId,

    async begin(branch, resolutionReason) {
      try {
        await conversation.send(promptFor(ticket, branch, context, resolutionReason));
      } finally {
        // Whatever it managed to say before it stopped — including the last words of a
        // turn that fell over, which are usually the ones that say why.
        settle();
      }
    },

    onLine(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    ran: () => ranIn(conversation.transcript()),

    close() {
      stopHearing();
      conversation.close();
      // The row stays. A run is a chat, and a run that is over is the one a person most
      // wants to read — what it did, and why it stopped there — so the window keeps it
      // beside the others instead of closing it the moment it stops talking. Its words are
      // on the ticket either way, which is what makes throwing the chat away safe rather
      // than what makes keeping it unnecessary (GH #68).
    },
  };
}

/**
 * What a run is told when it starts.
 *
 * The ticket is the whole of it — what to build, and how it will be known to be done —
 * copied out rather than referred to, because the ticket can be edited while the run goes
 * and a run should be working to the words it was given (GH #57). The tail is by kind,
 * because what proves a ticket done is not the same question for a prototype as for a
 * question.
 *
 * The first line is the ticket's own name, and that is not decoration: a chat is named by
 * the first thing a person asked it, so the row this run leaves in the sidebar is named
 * for the ticket rather than for the paragraph of instructions the run was handed.
 */
export function promptFor(
  ticket: Ticket,
  branch: string,
  contextOrReason: RunContext | string = EMPTY_CONTEXT,
  resolutionReason?: string,
): string {
  if (ticket.kind === 'map') throw new Error(MAP_RUN_REFUSAL);

  const context = typeof contextOrReason === 'string' ? EMPTY_CONTEXT : contextOrReason;
  const reason = typeof contextOrReason === 'string' ? contextOrReason : resolutionReason;
  const body = ticket.body.trim();
  const spec =
    context.spec === null
      ? ['Enclosing spec: none (this ticket is outside a spec).']
      : [
          `Enclosing spec: ${context.spec.name} — ${context.spec.title}`,
          'Spec body:',
          context.spec.body.trim() === ''
            ? '(nothing was written down beyond the title)'
            : context.spec.body,
        ];
  const siblings =
    context.siblings.length === 0
      ? ['Sibling tickets: none.']
      : [
          'Sibling tickets:',
          ...context.siblings.map(
            (sibling) =>
              `- ${sibling.name} — ${sibling.title} [${sibling.kind}; ${sibling.band}]${ticket.kind !== 'spec' || sibling.criteria.length === 0 ? '' : `\n${sibling.criteria.map((criterion) => `  - ${criterion}`).join('\n')}`}`,
          ),
        ];
  const glossary =
    context.glossary.length === 0
      ? ['Project glossary: empty.']
      : [
          'Project glossary:',
          ...context.glossary.map(
            (entry) =>
              `- ${entry.term}: ${entry.meaning}${entry.wordsToAvoid.length === 0 ? '' : ` (avoid: ${entry.wordsToAvoid.join(', ')})`}`,
          ),
        ];
  const decisions =
    context.decisions.length === 0
      ? ['Decisions cited by the spec: none.']
      : [
          'Decisions cited by the spec:',
          ...context.decisions.map(
            (decision) =>
              `- ${decision.choice} (context: ${decision.context}; rejected: ${decision.rejectedOptions.join(', ') || 'none'}; consequences: ${decision.consequences})`,
          ),
        ];

  return [
    `${ticket.name} — ${ticket.title}`,
    '',
    `You are running this ticket. Work in this folder: a checkout of the project on the branch \`${branch}\`, which is not merged into anything. Leave the project's own folder alone.`,
    ...(reason === undefined
      ? []
      : [
          '',
          'This is a conflict-resolution run. Bring this ticket branch up to date with the enclosing spec branch, resolve the conflict, and leave the branch ready to be merged again.',
          `The conflict reason was: ${reason}`,
        ]),
    '',
    'What to build:',
    body === '' ? '(nothing was written down beyond the title)' : body,
    '',
    'It is known to be done when:',
    ...ticket.criteria.map((each) => `- ${each}`),
    '',
    'Project and sibling context:',
    ...spec,
    ...siblings,
    ...(ticket.kind === 'spec' && context.siblings.length > 0
      ? [
          '',
          'This is an integration run for the spec. Check every child’s acceptance criteria together against the spec request, and verify the integrated result satisfies them as a whole.',
        ]
      : []),
    ...glossary,
    ...decisions,
    '',
    `Required workflow skill: /${SKILLS[ticket.kind]}.`,
    TAILS[ticket.kind],
    'When the criteria hold, finish by saying briefly what you changed and what you ran.',
  ].join('\n');
}

/** What proves a ticket of each kind done, which is not the same question for all of them. */
const TAILS: Record<Exclude<TicketKind, 'map'>, string> = {
  prototype:
    'This is a prototype: make it work, and say what you saw it do rather than what it should do.',
  bug: 'This is a bug: make it stop, and leave behind the test that would have caught it.',
  feature: 'This is a feature: build it, and cover it with tests.',
  refactor:
    'This is a refactor: the behaviour must not change, so the tests are what say you are done.',
  question: 'This is a question: find the answer, and write down the evidence that supports it.',
  research:
    'This is research: investigate the subject, and record what you learned with its sources.',
  spec: 'This is a spec: make the desired behaviour precise, and say how it will be known to be done.',
};

const SKILLS: Record<Exclude<TicketKind, 'map'>, string> = {
  prototype: 'prototype',
  bug: 'diagnosing-bugs',
  feature: 'implement',
  refactor: 'implement',
  question: 'research',
  research: 'research',
  spec: 'to-spec',
};

/**
 * The lines of a transcript nobody has been handed yet, oldest first.
 *
 * A line is taken once and once only, by message id, so a reply that arrives in pieces is
 * handed over when it has stopped arriving rather than written to the ticket five times.
 * A message that says nothing — a step that was only a tool call — is marked as taken
 * without being handed over, because there is nothing in it to keep.
 */
export function linesIn(
  transcript: ChatTranscript,
  handedOver: Set<string>,
  writing: boolean,
): RunLine[] {
  const lines: RunLine[] = [];

  for (const message of transcript.messages) {
    if (handedOver.has(message.id)) continue;
    if (message.role === 'kira' && writing) continue;

    const words = wordsIn(message);
    handedOver.add(message.id);

    if (words !== '') {
      lines.push({ saidBy: message.role === 'you' ? 'person' : 'agent', words });
    }
  }

  return lines;
}

function wordsIn(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/**
 * The shell commands a run ran, in the order it first ran them.
 *
 * This is what a proposal's checks are, and they are recorded as what they are: not a
 * guess about which of a run's commands were the checks — a run that ran `bun test` ran
 * it, and a run that ran `ls` ran that — but the truth about what it did to find out
 * whether it was done.
 */
export function ranIn(transcript: ChatTranscript): string[] {
  const ran: string[] = [];

  for (const message of transcript.messages) {
    for (const part of message.parts) {
      if (part.type !== 'work') continue;

      for (const call of part.calls) {
        if (call.name !== 'bash' || call.target === null) continue;
        if (!ran.includes(call.target)) ran.push(call.target);
      }
    }
  }

  return ran;
}
