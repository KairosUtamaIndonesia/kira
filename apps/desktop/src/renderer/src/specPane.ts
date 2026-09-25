import type {
  MapChildProposal,
  Proposal,
  ShapingState,
  SpecProposal,
  Ticket,
  TicketQueue,
} from '../../preload/bridge';

export function specMarkdown(proposal: SpecProposal): string {
  const stories = proposal.stories.map((story) => `- ${story}`).join('\n');
  return `# Problem\n\n${proposal.problem}\n\n# Solution\n\n${proposal.solution}\n\n# Stories\n\n${stories}`;
}

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/** What a proposal says, as the Markdown its card draws. */
export function proposalMarkdown(proposal: Proposal): string {
  switch (proposal.kind) {
    case 'spec':
      return specMarkdown(proposal);
    case 'map': {
      const children = (heading: string, each: readonly MapChildProposal[]) =>
        each.length === 0
          ? []
          : [
              `## ${heading}`,
              each.map((child) => `- **${child.title}** — ${child.body}`).join('\n'),
            ];
      return [
        `# ${proposal.title}`,
        proposal.body,
        ...(proposal.criteria.length === 0 ? [] : ['## Done when', list(proposal.criteria)]),
        ...children('Questions', proposal.questions),
        ...children('Research', proposal.research),
      ].join('\n\n');
    }
    case 'decision':
      return [
        '## Context',
        proposal.context,
        '## Choice',
        proposal.choice,
        ...(proposal.rejectedOptions.length === 0
          ? []
          : ['## Rejected options', list(proposal.rejectedOptions)]),
        '## Consequences',
        proposal.consequences,
      ].join('\n\n');
    case 'outcome':
      return [
        proposal.answer,
        ...(proposal.sources.length === 0 ? [] : ['## Sources', list(proposal.sources)]),
      ].join('\n\n');
    case 'breakdown': {
      // Slices name what they wait on by id; a reader follows the numbers.
      const number = new Map(proposal.slices.map((slice, index) => [slice.id, index + 1]));
      return proposal.slices
        .map((slice, index) => {
          const after = slice.dependsOn.map((id) => number.get(id) ?? id).join(', ');
          return [
            `## ${index + 1}. ${slice.title}`,
            after === '' ? `*${slice.kind}*` : `*${slice.kind}* · after ${after}`,
            slice.body,
            ...(slice.criteria.length === 0 ? [] : [list(slice.criteria)]),
          ].join('\n\n');
        })
        .join('\n\n');
    }
  }
}

/** The latest proposal of each of `kinds`, in the order they were proposed. */
export function latestProposals(
  state: ShapingState,
  kinds: readonly Proposal['kind'][],
): Proposal[] {
  return state.proposals.filter(
    (proposal, index) =>
      kinds.includes(proposal.kind) &&
      !state.proposals.slice(index + 1).some((later) => later.kind === proposal.kind),
  );
}

/** The spec ticket a person approved last in this chat, which tickets and runs hang from. */
export function approvedSpecTicket(state: ShapingState): string | null {
  const approved = state.proposals.filter(
    (proposal) => proposal.kind === 'spec' && proposal.status === 'approved',
  );
  const spec = approved.at(-1);
  return spec?.kind === 'spec' ? spec.ticketId : null;
}

/** A published breakdown whose readiness the server refused can retry readiness alone. */
export function canRetryBreakdownReady(
  proposal: Proposal,
): proposal is Extract<Proposal, { kind: 'breakdown' }> {
  return (
    proposal.kind === 'breakdown' &&
    proposal.status === 'approved' &&
    proposal.ticketIds.length > 0 &&
    proposal.readyRefusal !== null
  );
}

/** Which of the workbench's shaping tabs this chat has anything to show in. */
export function shapingTabs(state: ShapingState | undefined): { spec: boolean; tickets: boolean } {
  if (state === undefined) return { spec: false, tickets: false };
  return {
    spec: state.proposals.some((proposal) => proposal.kind !== 'breakdown'),
    tickets:
      approvedSpecTicket(state) !== null ||
      state.proposals.some((proposal) => proposal.kind === 'breakdown'),
  };
}

export function ticketsFor(queue: TicketQueue | null, specTicketId: string | null): Ticket[] {
  if (queue === null || specTicketId === null) return [];
  const spec = queue.tickets.find((ticket) => ticket.id === specTicketId);
  if (spec === undefined) return [];

  const children = spec.children
    .map((child) => queue.tickets.find((ticket) => ticket.id === child.id))
    .filter((ticket): ticket is Ticket => ticket !== undefined);

  // The approved spec is itself the linked ticket. Keep it in the pane even
  // before slices exist, then show any slices beneath it as the server reports
  // them. This makes the exact approved ticket and its derived band visible.
  return [spec, ...children];
}
