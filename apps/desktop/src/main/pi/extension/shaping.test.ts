import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type {
  BreakdownProposal,
  DecisionProposal,
  MapProposal,
  OutcomeProposal,
  ShapingState,
  SpecProposal,
} from '../../../preload/bridge.ts';
import { shapingFrom } from './shaping.ts';

const spec: SpecProposal = {
  id: 'spec-1',
  chatId: 'chat-1',
  problem: 'The queue hides agreed work.',
  solution: 'Show agreed work first.',
  stories: ['A contributor sees agreed work.'],
  status: 'approved',
  ticketId: 'ticket-spec',
};
const map: MapProposal = {
  id: 'map-1',
  chatId: 'chat-1',
  title: 'Queue overhaul',
  body: 'Too big for one spec.',
  criteria: ['Settled'],
  questions: [],
  research: [],
  status: 'proposed',
  ticketId: null,
};
const decision: DecisionProposal = {
  id: 'decision-1',
  chatId: 'chat-1',
  context: 'Approval is explicit.',
  choice: 'Keep it person-owned.',
  rejectedOptions: ['Automatic publication.'],
  consequences: 'The person stays in control.',
  supersedes: null,
  status: 'proposed',
  decisionId: null,
};
const outcome: OutcomeProposal = {
  id: 'outcome-1',
  chatId: 'chat-1',
  ticketId: 'question-1',
  answer: 'Yes.',
  sources: ['https://example.com'],
  decisionProposal: null,
  status: 'replaced',
  outcomeId: null,
};
const breakdown: BreakdownProposal = {
  id: 'breakdown-1',
  chatId: 'chat-1',
  slices: [{ id: 'a', kind: 'feature', title: 'A', body: 'a', criteria: ['a'], dependsOn: [] }],
  status: 'proposed',
  ticketIds: [],
};
test('stored shaping is read into one proposal list without losing a proposal', () => {
  const cases: Array<{ name: string; stored: unknown; want: ShapingState }> = [
    { name: 'nothing stored', stored: null, want: { proposals: [] } },
    { name: 'malformed value', stored: 'not shaping', want: { proposals: [] } },
    {
      name: 'a list is read as it was written',
      stored: { proposals: [{ kind: 'spec', ...spec }], runReady: { phase: 'complete' } },
      want: { proposals: [{ kind: 'spec', ...spec }] },
    },
    {
      name: 'a legacy offer and interview with no proposal leave nothing',
      stored: {
        offer: 'accepted',
        offerRequested: true,
        interview: { answers: [{ questionId: 'problem', text: 'x', source: 'typed' }] },
        proposal: null,
      },
      want: { proposals: [] },
    },
    {
      name: 'every legacy slot is carried into the list',
      stored: {
        offer: 'dismissed',
        interview: null,
        proposal: spec,
        mapProposal: map,
        decisionProposal: decision,
        outcomeProposal: outcome,
        breakdown,
      },
      want: {
        proposals: [
          { kind: 'spec', ...spec },
          { kind: 'map', ...map },
          { kind: 'decision', ...decision },
          { kind: 'outcome', ...outcome },
          { kind: 'breakdown', ...breakdown, readyRefusal: null },
        ],
      },
    },
    {
      name: 'legacy dismissed and published statuses become rejected and approved',
      stored: {
        offer: 'unoffered',
        proposal: { ...spec, status: 'dismissed' },
        decisionProposal: { ...decision, status: 'dismissed' },
        breakdown: { ...breakdown, status: 'published', ticketIds: ['t-a'] },
      },
      want: {
        proposals: [
          { kind: 'spec', ...spec, status: 'rejected' },
          { kind: 'decision', ...decision, status: 'rejected' },
          {
            kind: 'breakdown',
            ...breakdown,
            status: 'approved',
            ticketIds: ['t-a'],
            readyRefusal: null,
          },
        ],
      },
    },
  ];

  for (const item of cases) {
    assert.deepEqual(shapingFrom(item.stored), item.want, item.name);
  }
});
