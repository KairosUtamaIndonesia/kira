import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';
import { randomUUID } from 'node:crypto';
import {
  TICKET_KINDS,
  type BreakdownSlice,
  type GlossaryChangeNote,
  type GlossaryEdit,
  type TicketChange,
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

  return [
    tool({
      name: 'tracker_queue',
      label: 'Read tracker queue',
      description:
        'Read the current project queue, including every ticket and its server-derived band.',
      promptSnippet: 'Read the current project queue and ticket bands.',
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
      name: 'tracker_write_draft',
      label: 'Write tracker draft',
      description:
        'Ticket creation is person-owned. Kira may edit an existing draft with tracker_edit_draft but cannot create tracker tickets.',
      promptSnippet: 'Never create tracker tickets; edit only an existing draft ticket.',
      parameters: DRAFT,
      async execute() {
        throw new Error('Kira cannot create tracker tickets; a person must create them.');
      },
    }),
    tool({
      name: 'tracker_edit_draft',
      label: 'Edit tracker draft',
      description:
        'Edit the title, body, or acceptance criteria of a draft ticket only. Gate, readiness, closure, publication, and Decision approval are not available.',
      promptSnippet: 'Edit a draft ticket without changing readiness or approval.',
      parameters: EDIT,
      async execute(params) {
        const edit = params as {
          ref: string;
          title?: string;
          body?: string;
          criteria?: string[];
        };
        const current = await tracker.readTicket(edit.ref);
        if (current.gate !== 'draft') {
          throw new Error('Kira can only edit draft tickets.');
        }

        const change: TicketChange = {};
        if (edit.title !== undefined) change.title = edit.title;
        if (edit.body !== undefined) change.body = edit.body;
        if (edit.criteria !== undefined) change.criteria = edit.criteria;
        return textResult(await tracker.change(current.id, change));
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
