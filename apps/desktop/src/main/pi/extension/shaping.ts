import { randomUUID } from 'node:crypto';
import {
  TICKET_KINDS,
  type BreakdownProposal,
  type BreakdownSlice,
  type DecisionProposal,
  type MapProposal,
  type OutcomeProposal,
  type Proposal,
  type ProposalStatus,
  type ShapingState,
  type SpecProposal,
} from '../../../preload/bridge.ts';

/** The structured payload returned by Kira's non-blocking spec proposal tool. */
export interface SpecProposalInput {
  problem: string;
  solution: string;
  stories: string[];
}

/** Validate untrusted tool details before they cross into renderer state. */
export function proposalIn(value: unknown, chatId: string): SpecProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as Partial<SpecProposalInput> & {
    id?: unknown;
    status?: unknown;
    mapTicketId?: unknown;
  };
  if (typeof held.problem !== 'string' || held.problem.trim() === '') return null;
  if (typeof held.solution !== 'string' || held.solution.trim() === '') return null;
  if (!Array.isArray(held.stories) || !held.stories.every((story) => typeof story === 'string')) {
    return null;
  }

  return {
    id: typeof held.id === 'string' && held.id !== '' ? held.id : randomUUID(),
    chatId,
    problem: held.problem,
    solution: held.solution,
    stories: held.stories,
    mapTicketId: typeof held.mapTicketId === 'string' ? held.mapTicketId : null,
    status: 'proposed',
    ticketId: null,
  };
}

/** Validate a breakdown before it becomes renderer-visible structured data. */
export function breakdownIn(value: unknown, chatId: string): BreakdownProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as { id?: unknown; slices?: unknown };
  if (typeof held.id !== 'string' || !Array.isArray(held.slices) || held.slices.length === 0)
    return null;
  const slices: BreakdownSlice[] = [];
  const ids = new Set<string>();
  for (const item of held.slices) {
    if (typeof item !== 'object' || item === null) return null;
    const slice = item as Partial<BreakdownSlice>;
    if (
      typeof slice.id !== 'string' ||
      ids.has(slice.id) ||
      typeof slice.kind !== 'string' ||
      !TICKET_KINDS.includes(slice.kind as (typeof TICKET_KINDS)[number]) ||
      typeof slice.title !== 'string' ||
      typeof slice.body !== 'string' ||
      !Array.isArray(slice.criteria) ||
      !slice.criteria.every((each) => typeof each === 'string') ||
      !Array.isArray(slice.dependsOn) ||
      !slice.dependsOn.every((each) => typeof each === 'string')
    )
      return null;
    ids.add(slice.id);
    slices.push(slice as BreakdownSlice);
  }
  if (slices.some((slice) => slice.dependsOn.some((dependency) => !ids.has(dependency))))
    return null;
  return { id: held.id, chatId, slices, status: 'proposed', ticketIds: [] };
}

export function decisionProposalIn(value: unknown, chatId: string): DecisionProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as {
    id?: unknown;
    context?: unknown;
    choice?: unknown;
    rejectedOptions?: unknown;
    consequences?: unknown;
    supersedes?: unknown;
  };
  if (
    typeof held.context !== 'string' ||
    held.context.trim() === '' ||
    typeof held.choice !== 'string' ||
    held.choice.trim() === '' ||
    !Array.isArray(held.rejectedOptions) ||
    !held.rejectedOptions.every((option) => typeof option === 'string') ||
    typeof held.consequences !== 'string' ||
    held.consequences.trim() === '' ||
    (held.supersedes !== null && typeof held.supersedes !== 'string')
  ) {
    return null;
  }
  return {
    id: typeof held.id === 'string' && held.id !== '' ? held.id : randomUUID(),
    chatId,
    context: held.context,
    choice: held.choice,
    rejectedOptions: held.rejectedOptions,
    consequences: held.consequences,
    supersedes: held.supersedes as string | null,
    status: 'proposed',
    decisionId: null,
  };
}

export function mapProposalIn(value: unknown, chatId: string): MapProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    criteria?: unknown;
    questions?: unknown;
    research?: unknown;
  };
  const childrenIn = (children: unknown): MapProposal['questions'] | null => {
    if (!Array.isArray(children)) return null;
    const parsed = children.map((child) => {
      if (typeof child !== 'object' || child === null) return null;
      const item = child as {
        title?: unknown;
        body?: unknown;
        criteria?: unknown;
      };
      if (
        typeof item.title !== 'string' ||
        typeof item.body !== 'string' ||
        !Array.isArray(item.criteria) ||
        !item.criteria.every((criterion) => typeof criterion === 'string')
      )
        return null;
      return { title: item.title, body: item.body, criteria: item.criteria };
    });
    return parsed.some((child) => child === null) ? null : (parsed as MapProposal['questions']);
  };
  const questions = childrenIn(held.questions);
  const research = childrenIn(held.research);
  if (
    typeof held.title !== 'string' ||
    held.title.trim() === '' ||
    typeof held.body !== 'string' ||
    !Array.isArray(held.criteria) ||
    !held.criteria.every((criterion) => typeof criterion === 'string') ||
    questions === null ||
    research === null
  )
    return null;
  return {
    id: typeof held.id === 'string' && held.id !== '' ? held.id : randomUUID(),
    chatId,
    title: held.title,
    body: held.body,
    criteria: held.criteria,
    questions,
    research,
    status: 'proposed',
    ticketId: null,
  };
}

export function outcomeProposalIn(value: unknown, chatId: string): OutcomeProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as {
    id?: unknown;
    ticketId?: unknown;
    answer?: unknown;
    sources?: unknown;
    decisionProposal?: unknown;
  };
  if (
    typeof held.ticketId !== 'string' ||
    held.ticketId.trim() === '' ||
    typeof held.answer !== 'string' ||
    held.answer.trim() === '' ||
    !Array.isArray(held.sources) ||
    !held.sources.every((source) => typeof source === 'string' && source.trim() !== '')
  )
    return null;
  let decisionProposal: OutcomeProposal['decisionProposal'] = null;
  if (held.decisionProposal !== undefined && held.decisionProposal !== null) {
    if (typeof held.decisionProposal !== 'object') return null;
    const proposal = held.decisionProposal as Record<string, unknown>;
    if (
      typeof proposal.context !== 'string' ||
      proposal.context.trim() === '' ||
      typeof proposal.choice !== 'string' ||
      proposal.choice.trim() === '' ||
      !Array.isArray(proposal.rejectedOptions) ||
      !proposal.rejectedOptions.every(
        (option) => typeof option === 'string' && option.trim() !== '',
      ) ||
      typeof proposal.consequences !== 'string' ||
      proposal.consequences.trim() === '' ||
      (proposal.supersedes !== null && typeof proposal.supersedes !== 'string')
    )
      return null;
    decisionProposal = {
      context: proposal.context,
      choice: proposal.choice,
      rejectedOptions: proposal.rejectedOptions,
      consequences: proposal.consequences,
      supersedes: proposal.supersedes as string | null,
    };
  }
  return {
    id: typeof held.id === 'string' && held.id !== '' ? held.id : randomUUID(),
    chatId,
    ticketId: held.ticketId,
    answer: held.answer,
    sources: held.sources,
    decisionProposal,
    status: 'proposed',
    outcomeId: null,
  };
}

/** Markdown used by the Workbench Spec tab; it is not the chat's plain-text draft. */
export function markdownFor(proposal: SpecProposal): string {
  const stories = proposal.stories.map((story) => `- ${story}`).join('\n');
  return `# Problem\n\n${proposal.problem}\n\n# Solution\n\n${proposal.solution}\n\n# Stories\n\n${stories}`;
}

/** A chat that has proposed nothing yet. */
export function noShaping(): ShapingState {
  return { proposals: [] };
}

/**
 * Add a proposal Kira has just made. Only the latest proposal of a kind can be
 * approved, so an earlier one of that kind still waiting is replaced.
 */
export function withProposal(proposals: Proposal[], next: Proposal): Proposal[] {
  return [
    ...proposals.map((each) =>
      each.kind === next.kind && each.status === 'proposed'
        ? { ...each, status: 'replaced' as const }
        : each,
    ),
    next,
  ];
}

/** Shaping as chats stored it before the one list: a slot per kind beside an offer. */
interface LegacyShaping {
  proposal?: SpecProposal | null;
  mapProposal?: MapProposal | null;
  decisionProposal?: DecisionProposal | null;
  outcomeProposal?: OutcomeProposal | null;
  breakdown?: BreakdownProposal | null;
}

/**
 * What a chat holds, read from what was stored for it. A chat stored before the
 * one proposal list kept each kind in its own slot beside an offer and an
 * interview: its proposals are carried into the list and the rest is dropped.
 */
export function shapingFrom(stored: unknown): ShapingState {
  if (typeof stored !== 'object' || stored === null) return noShaping();
  const held = stored as LegacyShaping & { proposals?: unknown };

  return {
    proposals: Array.isArray(held.proposals)
      ? (held.proposals as Proposal[])
      : legacyProposals(held),
  };
}

function legacyProposals(held: LegacyShaping): Proposal[] {
  const proposals: Proposal[] = [];
  if (held.proposal) proposals.push({ kind: 'spec', ...held.proposal });
  if (held.mapProposal) proposals.push({ kind: 'map', ...held.mapProposal });
  if (held.decisionProposal) proposals.push({ kind: 'decision', ...held.decisionProposal });
  if (held.outcomeProposal) proposals.push({ kind: 'outcome', ...held.outcomeProposal });
  if (held.breakdown) proposals.push({ kind: 'breakdown', ...held.breakdown, readyRefusal: null });

  // Legacy slots could hold a dismissed proposal or a published breakdown.
  return proposals.map((each) => {
    const status = each.status as ProposalStatus | 'dismissed' | 'published';
    return {
      ...each,
      status: status === 'dismissed' ? 'rejected' : status === 'published' ? 'approved' : status,
    };
  });
}
