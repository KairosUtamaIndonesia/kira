import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';
import { randomUUID } from 'node:crypto';
import {
  TICKET_KINDS,
  TICKET_PRIORITIES,
  type BreakdownSlice,
  type GlossaryChangeNote,
  type GlossaryEdit,
  type TicketChange,
  type TicketDraft,
  type TicketStatus,
  type Ticket,
} from '../../../preload/bridge.ts';
import type { ThreadStore } from '../../db/threads.ts';
import type { Tracker } from '../../tracker.ts';

const EMPTY = Type.Object({});
const TICKET = Type.Object({ ref: Type.String({ minLength: 1 }) });
const DRAFT = Type.Object({
  kind: Type.String({ minLength: 1 }),
  title: Type.String(),
  body: Type.String(),
  criteria: Type.Array(Type.String()),
});
const EDIT = Type.Object({
  ref: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  criteria: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(
    Type.Union([Type.Literal('running'), Type.Literal('needs-review')], {
      description: 'Use "running" for Running or "needs-review" for Needs review.',
    }),
  ),
  pullRequestUrl: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: 'The HTTPS URL of the pull request Kira just opened.',
    }),
  ),
  priority: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
});
const GLOSSARY = Type.Object({
  term: Type.String({ minLength: 1 }),
  meaning: Type.String({ minLength: 1 }),
  wordsToAvoid: Type.Array(Type.String()),
});
const SPEC_PROPOSAL = Type.Object({
  problem: Type.String({ minLength: 1 }),
  solution: Type.String({ minLength: 1 }),
  stories: Type.Array(Type.String()),
  mapTicketId: Type.Optional(Type.String({ minLength: 1 })),
});
const MAP_CHILD = Type.Object({
  title: Type.String({ minLength: 1 }),
  body: Type.String(),
  criteria: Type.Array(Type.String()),
});
const MAP_PROPOSAL = Type.Object({
  title: Type.String({ minLength: 1 }),
  body: Type.String(),
  criteria: Type.Array(Type.String()),
  questions: Type.Array(MAP_CHILD),
  research: Type.Array(MAP_CHILD),
});
const OUTCOME_PROPOSAL = Type.Object({
  ticketId: Type.String({ minLength: 1 }),
  answer: Type.String({ minLength: 1 }),
  sources: Type.Array(Type.String({ minLength: 1 })),
  decisionProposal: Type.Optional(
    Type.Union([
      Type.Object({
        context: Type.String({ minLength: 1 }),
        choice: Type.String({ minLength: 1 }),
        rejectedOptions: Type.Array(Type.String({ minLength: 1 })),
        consequences: Type.String({ minLength: 1 }),
        supersedes: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      }),
      Type.Null(),
    ]),
  ),
});
const DECISION_PROPOSAL = Type.Object({
  context: Type.String({ minLength: 1 }),
  choice: Type.String({ minLength: 1 }),
  rejectedOptions: Type.Array(Type.String()),
  consequences: Type.String({ minLength: 1 }),
  supersedes: Type.Optional(Type.String({ minLength: 1 })),
});
const BREAKDOWN_PROPOSAL = Type.Object({
  slices: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1 }),
      kind: Type.Union(TICKET_KINDS.map((kind) => Type.Literal(kind))),
      title: Type.String(),
      body: Type.String(),
      criteria: Type.Array(Type.String()),
      dependsOn: Type.Array(Type.String()),
    }),
  ),
});

function textResult(value: unknown, details: unknown = undefined): AgentToolResult<undefined> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    // pi persists tool-result details beside its transcript. The details are
    // deliberately a small, validated note rather than a second glossary copy.
    details: details as undefined,
  };
}

/**
 * What a proposal tool answers. Details carry the proposal for the window's
 * approval card; the words tell Kira the person decides next.
 */
function proposed(what: string, kind: string, proposal: unknown): AgentToolResult<undefined> {
  return {
    content: [
      {
        type: 'text',
        text: `An approval card for this ${what} is now shown to the person. Nothing has been written to the tracker. Wait for the person to approve or reject it.`,
      },
    ],
    details: { kind, proposal } as never,
  };
}

function workspaceFor(store: ThreadStore, threadId: string): string {
  const workspaceId = store.findThread(threadId)?.workspaceId;
  if (workspaceId === undefined || workspaceId === null) {
    throw new Error('This chat is not filed in a project workspace.');
  }

  return workspaceId;
}

function tool<T extends TSchema>(
  definition: Omit<ToolDefinition<T>, 'execute'> & {
    execute(
      params: Record<string, unknown>,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<undefined>>;
  },
): ToolDefinition<T> {
  return {
    ...definition,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return definition.execute(params as Record<string, unknown>, ctx);
    },
  } as ToolDefinition<T>;
}

/** The tracker capabilities available to every Kira session. */
export function trackerTools(
  store: ThreadStore,
  threadId: string,
  tracker: Tracker,
): ToolDefinition[] {
  const workspace = (): string => workspaceFor(store, threadId);
  const linkedTicket = async (ref: string): Promise<Ticket> => {
    const ticket = await tracker.readTicket(ref);
    if (!store.getThread(threadId).workTicketIds.includes(ticket.id)) {
      throw new Error('This chat can only change tickets linked to it.');
    }
    return ticket;
  };

  return [
    tool({
      name: 'tracker_queue',
      label: 'Read tracker queue',
      description: 'Read the current project queue, including every ticket and its stored status.',
      promptSnippet: 'Read the current project queue and ticket statuses.',
      parameters: EMPTY,
      async execute() {
        return textResult(await tracker.queue(workspace()));
      },
    }),
    tool({
      name: 'tracker_read_ticket',
      label: 'Read tracker ticket',
      description: 'Read one tracker ticket in full by its id or human-readable name.',
      promptSnippet: 'Read one tracker ticket by id or name.',
      parameters: TICKET,
      async execute(params) {
        const { ref } = params as { ref: string };
        return textResult(await tracker.readTicket(ref));
      },
    }),
    tool({
      name: 'tracker_read_glossary',
      label: 'Read project glossary',
      description: 'Read the current project glossary through the main-process tracker seam.',
      promptSnippet: 'Read project terms and meanings.',
      parameters: EMPTY,
      async execute() {
        return textResult((await tracker.glossary?.(workspace())) ?? []);
      },
    }),
    tool({
      name: 'tracker_read_decisions',
      label: 'Read project Decisions',
      description: 'Read approved project Decisions through the main-process tracker seam.',
      promptSnippet: 'Read approved project Decisions.',
      parameters: EMPTY,
      async execute() {
        return textResult((await tracker.decisions?.(workspace())) ?? []);
      },
    }),
    tool({
      name: 'tracker_update_glossary',
      label: 'Update project glossary',
      description:
        'Add or sharpen a project term without asking for approval. The server records the author, this chat, and immutable history.',
      promptSnippet:
        'Add or sharpen a project glossary term; the person can undo the visible change.',
      parameters: GLOSSARY,
      async execute(params) {
        if (tracker.updateGlossary === undefined) {
          throw new Error('Glossary editing is unavailable.');
        }
        const edit = params as Omit<GlossaryEdit, 'chatId'>;
        const workspaceId = workspace();
        const entry = await tracker.updateGlossary(workspaceId, {
          ...edit,
          chatId: threadId,
        });
        const change: GlossaryChangeNote = {
          workspaceId,
          chatId: threadId,
          entryId: entry.id,
          version: entry.version,
          term: entry.term,
        };
        return textResult(entry, change);
      },
    }),
    tool({
      name: 'tracker_create_ticket',
      label: 'Create tracker ticket',
      description:
        'Create a Draft ticket in this project and link it to this chat. A person makes it Ready when it is ready to start; the agent cannot delete tickets or mark them Done or Won’t do.',
      promptSnippet: 'Create and link a Draft ticket in this project when asked.',
      parameters: DRAFT,
      async execute(params) {
        const draft = params as Omit<TicketDraft, 'status'>;
        const ticket = await tracker.write(workspace(), { ...draft, status: 'draft' });
        const current = store.getThread(threadId).workTicketIds;
        store.setThreadWorkTicketIds(threadId, [...new Set([...current, ticket.id])]);
        return textResult(ticket);
      },
    }),
    tool({
      name: 'tracker_update_ticket',
      label: 'Update tracker ticket',
      description:
        'Update a ticket linked to this chat. Set status to `running` (Running) or `needs-review` (Needs review); Done and Won’t do stay with the person. After opening a pull request, attach its HTTPS URL. With no remote, Needs review needs no URL; if a remote exists but publishing or opening the pull request fails, leave the ticket Running. Running assigns the ticket to the signed-in person.',
      promptSnippet:
        'Update a linked ticket: set `running` when work starts. After opening a pull request, set `needs-review` and attach its HTTPS URL. With no remote, set `needs-review` without a URL; if a remote exists but publishing or opening the pull request fails, leave the ticket `running` and report why. Never set Done or Won’t do.',
      parameters: EDIT,
      async execute(params) {
        const edit = params as {
          ref: string;
          title?: string;
          body?: string;
          criteria?: string[];
          status?: string;
          pullRequestUrl?: string | null;
          priority?: string;
          tags?: string[];
        };
        const current = await linkedTicket(edit.ref);

        const change: TicketChange = {};
        if (edit.title !== undefined) change.title = edit.title;
        if (edit.body !== undefined) change.body = edit.body;
        if (edit.criteria !== undefined) change.criteria = edit.criteria;
        if (edit.pullRequestUrl !== undefined) change.pullRequestUrl = edit.pullRequestUrl;
        if (edit.status !== undefined) {
          if (!['running', 'needs-review'].includes(edit.status)) {
            throw new Error('The agent can set only Running or Needs review.');
          }
        }
        const statusAfter = edit.status ?? current.status;
        const pullRequestUrlAfter =
          edit.pullRequestUrl === undefined ? current.pullRequestUrl : edit.pullRequestUrl;
        const clearingReviewLink =
          edit.status === undefined &&
          edit.pullRequestUrl === null &&
          current.status === 'needs-review';
        if (
          (edit.status === 'needs-review' || edit.pullRequestUrl !== undefined) &&
          statusAfter === 'needs-review' &&
          pullRequestUrlAfter === null
        ) {
          const thread = store.findThread(threadId);
          const remote = thread ? await tracker.checkoutHasRemote(thread.cwd) : null;
          if (remote === null && !clearingReviewLink) {
            throw new Error(
              'Could not determine whether this checkout has a remote. Leave the ticket Running and report the blocker.',
            );
          }
          if (remote && !clearingReviewLink) {
            throw new Error(
              'With a remote, Needs review requires a pull request URL. Leave or set the ticket to Running until the URL is available, and report any blocker.',
            );
          }
          if (remote !== false && clearingReviewLink) {
            change.status = 'running';
            change.assigneeId = await tracker.currentUserId();
          }
        }
        if (edit.status !== undefined) {
          change.status = edit.status as TicketStatus;
          if (edit.status === 'running') change.assigneeId = await tracker.currentUserId();
        }
        if (edit.priority !== undefined) {
          if (!TICKET_PRIORITIES.includes(edit.priority as (typeof TICKET_PRIORITIES)[number])) {
            throw new Error('Choose a supported ticket priority.');
          }
          change.priority = edit.priority as TicketChange['priority'];
        }
        if (edit.tags !== undefined) change.tags = edit.tags;
        return textResult(await tracker.change(current.id, change));
      },
    }),
    tool({
      name: 'tracker_add_blocker',
      label: 'Add ticket blocker',
      description: 'Add a ticket as a blocker to a ticket linked to this chat.',
      promptSnippet: 'Add a blocker to a ticket linked to this chat.',
      parameters: Type.Object({
        ref: Type.String({ minLength: 1 }),
        blockedBy: Type.String({ minLength: 1 }),
      }),
      async execute(params) {
        const { ref, blockedBy } = params as { ref: string; blockedBy: string };
        const ticket = await linkedTicket(ref);
        return textResult(await tracker.gate(ticket.id, blockedBy));
      },
    }),
    tool({
      name: 'tracker_remove_blocker',
      label: 'Remove ticket blocker',
      description: 'Remove a blocker from a ticket linked to this chat.',
      promptSnippet: 'Remove a blocker from a ticket linked to this chat.',
      parameters: Type.Object({
        ref: Type.String({ minLength: 1 }),
        blockedBy: Type.String({ minLength: 1 }),
      }),
      async execute(params) {
        const { ref, blockedBy } = params as { ref: string; blockedBy: string };
        const ticket = await linkedTicket(ref);
        return textResult(await tracker.ungate(ticket.id, blockedBy));
      },
    }),
  ];
}

/** Propose a map without writing or closing a ticket. */
export function mapProposalTool(): ToolDefinition {
  return tool({
    name: 'propose_map',
    label: 'Propose a map',
    description:
      'Propose an oversized idea with question and research children. This never creates a map; a person must approve it.',
    promptSnippet: 'Propose a map and its question/research children without writing tickets.',
    parameters: MAP_PROPOSAL,
    async execute(params) {
      return proposed('map', 'map-proposal', { id: randomUUID(), ...params });
    },
  });
}

/** Propose an Outcome without writing or closing a ticket. */
export function outcomeProposalTool(): ToolDefinition {
  return tool({
    name: 'propose_outcome',
    label: 'Propose an Outcome',
    description:
      'Propose an answer and supporting sources for a question or research ticket. This never writes or closes the ticket; a person approves question Outcomes.',
    promptSnippet:
      'Propose a structured answer with supporting sources without writing the ticket.',
    parameters: OUTCOME_PROPOSAL,
    async execute(params) {
      return proposed('Outcome', 'outcome-proposal', {
        id: randomUUID(),
        ...params,
        decisionProposal: params.decisionProposal ?? null,
      });
    },
  });
}

/** A proposal tool is deliberately separate from trackerTools: it cannot write a ticket. */
export function specProposalTool(): ToolDefinition {
  return tool({
    name: 'shape_spec_proposal',
    label: 'Propose a spec',
    description:
      'Propose a spec with its problem, solution and user stories. This never creates or edits a tracker ticket; a person must approve it.',
    promptSnippet: 'Propose the problem, solution and user stories without writing a ticket.',
    parameters: SPEC_PROPOSAL,
    async execute(params) {
      return proposed('spec', 'spec-proposal', { id: randomUUID(), ...params });
    },
  });
}

/** Propose a durable Decision without giving Kira a publication capability. */
export function decisionProposalTool(): ToolDefinition {
  return tool({
    name: 'propose_decision',
    label: 'Propose a Decision',
    description:
      'Propose a project Decision with context, choice, rejected options and consequences. This never creates or supersedes a Decision; a person must approve it.',
    promptSnippet: 'Propose a project Decision without writing it to the tracker.',
    parameters: DECISION_PROPOSAL,
    async execute(params) {
      return proposed('Decision', 'decision-proposal', {
        id: randomUUID(),
        ...params,
        supersedes: params.supersedes ?? null,
      });
    },
  });
}

/** A breakdown is a proposal, not a tracker write: approving it is person-owned. */
export function breakdownProposalTool(): ToolDefinition {
  return tool({
    name: 'shape_breakdown_proposal',
    label: 'Propose a spec breakdown',
    description:
      'Propose thin vertical slice tickets and their dependencies after a spec is approved. This never creates or edits tickets; a person must approve it.',
    promptSnippet: 'Propose draft child tickets and dependencies without writing them.',
    parameters: BREAKDOWN_PROPOSAL,
    async execute(params) {
      const raw = params.slices as Array<{
        id: string;
        kind: string;
        title: string;
        body: string;
        criteria: string[];
        dependsOn: string[];
      }>;
      const ids = new Set(raw.map((slice) => slice.id.trim()));
      for (const slice of raw) {
        if (!TICKET_KINDS.includes(slice.kind as (typeof TICKET_KINDS)[number])) {
          throw new Error(
            `Slice "${slice.id}" has unsupported kind "${slice.kind}". Use one of: ${TICKET_KINDS.join(', ')}.`,
          );
        }
        for (const dependency of slice.dependsOn) {
          if (!ids.has(dependency)) {
            throw new Error(
              `Slice "${slice.id}" depends on "${dependency}", which is not a sibling slice id. The approved spec gate is attached automatically.`,
            );
          }
        }
      }
      if (ids.size !== raw.length || ids.has('')) {
        throw new Error(
          'Every slice needs a unique non-empty id so sibling dependencies can be checked.',
        );
      }
      const slices: BreakdownSlice[] = raw.map((slice) => ({
        id: slice.id.trim(),
        kind: slice.kind as BreakdownSlice['kind'],
        title: slice.title,
        body: slice.body,
        criteria: slice.criteria,
        dependsOn: slice.dependsOn,
      }));
      return proposed('breakdown', 'breakdown-proposal', { id: randomUUID(), slices });
    },
  });
}
