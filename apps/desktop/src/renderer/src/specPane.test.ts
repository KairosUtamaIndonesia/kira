import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  approvedSpecTicket,
  latestProposals,
  proposalMarkdown,
  shapingTabs,
  specMarkdown,
  ticketsFor,
} from './specPane.ts';
import type { Proposal, ShapingState, SpecProposal, TicketQueue } from '../../preload/bridge';

const proposal: SpecProposal = {
  id: 'proposal-1',
  chatId: 'chat-1',
  problem: 'People lose the agreed work.',
  solution: 'Keep the spec beside the chat.',
  stories: ['A person can read the spec.'],
  status: 'approved',
  ticketId: 'ticket-spec',
};

const ticket = (id: string, kind: 'spec' | 'feature' = 'feature') => ({
  id,
  projectId: 'project-1',
  name: `${id.toUpperCase()}-1`,
  number: 1,
  kind,
  title: id,
  body: id,
  criteria: ['done'],
  gate: 'ready-for-agent' as const,
  band: 'blocked' as const,
  rank: 1,
  branch: id,
  author: null,
  gates: [],
  children: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  closure: null,
  claim: null,
  runs: [],
});

test('spec markdown keeps the proposal out of the chat transcript shape', () => {
  assert.equal(
    specMarkdown(proposal),
    '# Problem\n\nPeople lose the agreed work.\n\n# Solution\n\nKeep the spec beside the chat.\n\n# Stories\n\n- A person can read the spec.',
  );
});

test('ticketsFor starts with the exact approved ticket and then its child slices', () => {
  const child = ticket('ticket-child');
  const spec = {
    ...ticket('ticket-spec', 'spec'),
    children: [{ id: child.id, name: 'FND-2', closed: false, closure: null }],
  };
  const queue = {
    project: { id: 'project-1', name: 'Foundry', prefix: 'FND' },
    tickets: [spec, child],
    counts: { draft: 0, ready: 0, blocked: 2, running: 0, 'needs-you': 0, done: 0 },
  } satisfies TicketQueue;

  assert.deepEqual(ticketsFor(queue, proposal.ticketId), [spec, child]);
  assert.equal(ticketsFor(queue, proposal.ticketId)[1]?.band, 'blocked');
  assert.deepEqual(ticketsFor(queue, 'not-the-approved-ticket'), []);
});

const spec = (
  id: string,
  status: Proposal['status'],
  ticketId: string | null = null,
): Proposal => ({
  kind: 'spec',
  ...proposal,
  id,
  status,
  ticketId,
});

const breakdown = (
  id: string,
  status: Proposal['status'],
): Extract<Proposal, { kind: 'breakdown' }> => ({
  kind: 'breakdown',
  id,
  chatId: 'chat-1',
  slices: [
    {
      id: 'slice-a',
      kind: 'feature',
      title: 'Show the spec',
      body: 'Draw it beside the chat.',
      criteria: ['The spec is on screen.'],
      dependsOn: [],
    },
    {
      id: 'slice-b',
      kind: 'refactor',
      title: 'Approve it',
      body: 'One button.',
      criteria: [],
      dependsOn: ['slice-a', 'slice-gone'],
    },
  ],
  status,
  ticketIds: ['ticket-a'],
  readyRefusal: null,
});

const decision: Proposal = {
  kind: 'decision',
  id: 'decision-1',
  chatId: 'chat-1',
  context: 'Approval needs a record.',
  choice: 'A person approves.',
  rejectedOptions: [],
  consequences: 'People stay accountable.',
  supersedes: null,
  status: 'proposed',
  decisionId: null,
};

const shaping = (...proposals: Proposal[]): ShapingState => ({ proposals });
const SHAPING_CASES: Array<{
  name: string;
  state?: ShapingState;
  want: {
    tabs: { spec: boolean; tickets: boolean };
    approved: string | null;
    spec: string[];
    tickets: string[];
  };
}> = [
  {
    name: 'a chat with no proposals has no shaping tabs',
    state: shaping(),
    want: {
      tabs: { spec: false, tickets: false },
      approved: null,
      spec: [],
      tickets: [],
    },
  },
  {
    name: 'approved spec and proposed breakdown show both tabs',
    state: shaping(
      spec('spec-1', 'approved', 'ticket-spec'),
      decision,
      breakdown('breakdown-2', 'proposed'),
    ),
    want: {
      tabs: { spec: true, tickets: true },
      approved: 'ticket-spec',
      spec: ['spec-1', 'decision-1'],
      tickets: ['breakdown-2'],
    },
  },
];

for (const testCase of SHAPING_CASES) {
  test(testCase.name, () => {
    const state = testCase.state ?? shaping();
    assert.deepEqual(
      {
        tabs: shapingTabs(testCase.state),
        approved: approvedSpecTicket(state),
        spec: latestProposals(state, ['map', 'spec', 'decision', 'outcome']).map(({ id }) => id),
        tickets: latestProposals(state, ['breakdown']).map(({ id }) => id),
      },
      testCase.want,
    );
  });
}

const MARKDOWN_CASES: Array<{ name: string; proposal: Proposal; want: string }> = [
  {
    name: 'a spec is its problem, solution and stories',
    proposal: spec('spec-1', 'proposed'),
    want: specMarkdown(proposal),
  },
  {
    name: 'a breakdown numbers its slices and says what each waits on',
    proposal: breakdown('breakdown-1', 'proposed'),
    want: [
      '## 1. Show the spec',
      '*feature*',
      'Draw it beside the chat.',
      '- The spec is on screen.',
      '## 2. Approve it',
      '*refactor* \u00b7 after 1, slice-gone',
      'One button.',
    ].join('\n\n'),
  },
  {
    name: 'a Decision leaves out rejected options it has none of',
    proposal: decision,
    want: [
      '## Context',
      'Approval needs a record.',
      '## Choice',
      'A person approves.',
      '## Consequences',
      'People stay accountable.',
    ].join('\n\n'),
  },
  {
    name: 'an Outcome is its answer and its sources',
    proposal: {
      kind: 'outcome',
      id: 'outcome-1',
      chatId: 'chat-1',
      ticketId: 'question-1',
      answer: 'Keep approval person-owned.',
      sources: ['https://example.com'],
      decisionProposal: null,
      status: 'proposed',
      outcomeId: null,
    },
    want: 'Keep approval person-owned.\n\n## Sources\n\n- https://example.com',
  },
  {
    name: 'a map lists its criteria and the children it would open',
    proposal: {
      kind: 'map',
      id: 'map-1',
      chatId: 'chat-1',
      title: 'Shaping',
      body: 'Too big for one spec.',
      criteria: ['A spec is approved.'],
      questions: [{ title: 'Who approves?', body: 'Settle the gate.', criteria: [] }],
      research: [],
      status: 'proposed',
      ticketId: null,
    },
    want: [
      '# Shaping',
      'Too big for one spec.',
      '## Done when',
      '- A spec is approved.',
      '## Questions',
      '- **Who approves?** \u2014 Settle the gate.',
    ].join('\n\n'),
  },
];

for (const testCase of MARKDOWN_CASES) {
  test(testCase.name, () => {
    assert.equal(proposalMarkdown(testCase.proposal), testCase.want);
  });
}
