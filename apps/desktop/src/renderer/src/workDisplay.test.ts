import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Ticket } from '../../preload/bridge.ts';
import {
  canReorderReady,
  DEFAULT_WORK_DISPLAY,
  displayWork,
  groupedWork,
  planTicketDrop,
  readWorkDisplay,
  reorderReady,
} from './workDisplay.ts';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'one',
    projectId: 'project',
    name: 'FND-1',
    number: 1,
    kind: 'feature',
    title: 'A ticket',
    body: 'Build the thing',
    criteria: ['It works'],
    gate: 'ready-for-agent',
    band: 'ready',
    rank: 1,
    branch: 'fnd-1-a-ticket',
    author: null,
    gates: [],
    children: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    closure: null,
    claim: null,
    runs: [],
    ...overrides,
  };
}

test('readWorkDisplay restores persisted filters and rejects invalid values', () => {
  assert.deepEqual(
    readWorkDisplay(
      '?search=bug&band=ready&kind=bug&claim=unclaimed&order=updated&group=kind&done=1',
    ),
    {
      ...DEFAULT_WORK_DISPLAY,
      search: 'bug',
      band: 'ready',
      kind: 'bug',
      claim: 'unclaimed',
      order: 'updated',
      group: 'kind',
      showDone: true,
    },
  );
  assert.deepEqual(readWorkDisplay('?claim=invalid&band=unknown'), DEFAULT_WORK_DISPLAY);
});

test('canReorderReady only allows the unfiltered priority order', () => {
  assert.equal(canReorderReady(DEFAULT_WORK_DISPLAY), true);
  assert.equal(canReorderReady({ ...DEFAULT_WORK_DISPLAY, search: 'bug' }), false);
  assert.equal(canReorderReady({ ...DEFAULT_WORK_DISPLAY, order: 'updated' }), false);
  assert.equal(canReorderReady({ ...DEFAULT_WORK_DISPLAY, claim: 'claimed' }), false);
});

test('displayWork searches, filters, hides done by default, and orders the result', () => {
  const tickets = [
    ticket({ id: 'ready-2', name: 'FND-2', number: 2, title: 'Searchable', rank: 2 }),
    ticket({
      id: 'done-3',
      name: 'FND-3',
      number: 3,
      title: 'Searchable done',
      band: 'done',
      closedAt: '2026-01-03T00:00:00.000Z',
      closure: 'done',
      rank: 3,
    }),
    ticket({
      id: 'bug-1',
      name: 'FND-4',
      number: 4,
      kind: 'bug',
      title: 'A bug',
      rank: 1,
    }),
  ];

  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, search: 'searchable' }).map((each) => each.id),
    ['ready-2'],
  );
  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, showDone: true }).map((each) => each.id),
    ['bug-1', 'ready-2', 'done-3'],
  );
});

test('groupedWork groups filtered tickets by status or kind', () => {
  const tickets = [
    ticket({ id: 'ready', name: 'FND-1', number: 1, kind: 'feature', band: 'ready' }),
    ticket({ id: 'bug', name: 'FND-2', number: 2, kind: 'bug', band: 'blocked' }),
  ];

  assert.deepEqual(
    groupedWork(tickets, 'status').map((each) => [each.key, each.label, each.tickets.length]),
    [
      ['ready', 'Ready', 1],
      ['blocked', 'Blocked', 1],
    ],
  );
  assert.deepEqual(
    groupedWork(tickets, 'kind').map((each) => [each.key, each.label, each.tickets.length]),
    [
      ['feature', 'feature', 1],
      ['bug', 'bug', 1],
    ],
  );
});

test('reorderReady changes only the ready order and assigns contiguous ranks', () => {
  const tickets = [
    ticket({ id: 'draft', band: 'draft', rank: 0 }),
    ticket({ id: 'a', name: 'FND-2', number: 2, rank: 10 }),
    ticket({ id: 'b', name: 'FND-3', number: 3, rank: 20 }),
    ticket({ id: 'c', name: 'FND-4', number: 4, rank: 30 }),
  ];

  const reordered = reorderReady(tickets, 'c', 'a');

  assert.deepEqual(
    reordered.map((each) => each.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    reordered.map((each) => each.rank),
    [0, 1, 2],
  );
});

test('reorderReady ignores unknown and same-position drops', () => {
  const tickets = [ticket({ id: 'a' }), ticket({ id: 'b', name: 'FND-2', number: 2, rank: 2 })];

  assert.deepEqual(
    reorderReady(tickets, 'missing', 'a').map((each) => each.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    reorderReady(tickets, 'a', 'a').map((each) => each.id),
    ['a', 'b'],
  );
});

test('planTicketDrop maps cross-lane drops to supported ticket actions', () => {
  const run = {
    id: 'run-1',
    ticketId: 'one',
    workerId: 'worker-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    branch: 'fnd-1-a-ticket',
    stoppedBecause: null,
    changed: 'one file',
    checks: [],
    made: null,
    verdict: null,
  };
  const cases = [
    {
      name: 'draft into Ready asks how the ticket should be prepared',
      ticket: ticket({ band: 'draft', gate: 'draft' }),
      target: 'ready' as const,
      want: { kind: 'choose-ready-gate' },
    },
    {
      name: 'Ready into Draft changes the gate',
      ticket: ticket({ band: 'ready', gate: 'ready-for-agent' }),
      target: 'draft' as const,
      want: { kind: 'change-gate', gate: 'draft' },
    },
    {
      name: 'Ready for an agent into Running asks to start a run',
      ticket: ticket({ band: 'ready', gate: 'ready-for-agent' }),
      target: 'running' as const,
      want: { kind: 'start-run' },
    },
    {
      name: 'Ready for a person into Running first asks to make it agent-ready',
      ticket: ticket({ band: 'ready', gate: 'ready-for-human' }),
      target: 'running' as const,
      want: { kind: 'prepare-agent-run' },
    },
    {
      name: 'Draft into Running first asks to make it agent-ready',
      ticket: ticket({ band: 'draft', gate: 'draft' }),
      target: 'running' as const,
      want: { kind: 'prepare-agent-run' },
    },
    {
      name: 'Ready into Blocked asks for a dependency',
      ticket: ticket({ band: 'ready', gate: 'ready-for-agent' }),
      target: 'blocked' as const,
      want: { kind: 'add-blocker' },
    },
    {
      name: 'Blocked into Ready asks to resolve blockers',
      ticket: ticket({
        band: 'blocked',
        gate: 'ready-for-agent',
        children: [{ id: 'blocker', name: 'FND-2', closed: false, closure: null }],
      }),
      target: 'ready' as const,
      want: { kind: 'resolve-blockers' },
    },
    {
      name: 'Needs review into Ready sends the result back',
      ticket: ticket({ band: 'needs-you', runs: [run] }),
      target: 'ready' as const,
      want: { kind: 'send-back' },
    },
    {
      name: 'Needs review into Done accepts the real result',
      ticket: ticket({ band: 'needs-you', runs: [run] }),
      target: 'done' as const,
      want: { kind: 'accept-result' },
    },
    {
      name: 'Ready into Done asks for a closure reason',
      ticket: ticket({ band: 'ready', gate: 'ready-for-agent' }),
      target: 'done' as const,
      want: { kind: 'choose-closure' },
    },
    {
      name: 'a drop cannot manufacture a review result',
      ticket: ticket({ band: 'ready', gate: 'ready-for-agent' }),
      target: 'needs-you' as const,
      want: {
        kind: 'unavailable',
        reason: 'Needs review is created by a real question or run result, not a board action.',
      },
    },
    {
      name: 'a claimed ticket cannot be moved by hand',
      ticket: ticket({
        band: 'running',
        claim: {
          holder: { id: 'user-1', name: 'A person' },
          workerId: 'worker-1',
          startedAt: '2026-01-01T00:00:00.000Z',
          heardAt: null,
          leaseUntil: null,
          stale: false,
          quietMs: null,
        },
      }),
      target: 'draft' as const,
      want: {
        kind: 'unavailable',
        reason: 'A ticket with an active run cannot be moved by hand.',
      },
    },
    {
      name: 'a closed ticket cannot be reopened from the board',
      ticket: ticket({
        band: 'done',
        closedAt: '2026-01-01T00:00:00.000Z',
        closure: 'done',
      }),
      target: 'ready' as const,
      want: {
        kind: 'unavailable',
        reason: 'Closed tickets cannot be reopened from the board.',
      },
    },
    {
      name: 'a map cannot be manually closed',
      ticket: ticket({ kind: 'map', band: 'blocked', gate: 'ready-for-human' }),
      target: 'done' as const,
      want: {
        kind: 'unavailable',
        reason: 'A map closes only when its destination spec is approved.',
      },
    },
    {
      name: 'an empty spec cannot be unblocked by removing dependencies',
      ticket: ticket({ kind: 'spec', band: 'blocked', children: [] }),
      target: 'ready' as const,
      want: {
        kind: 'unavailable',
        reason: 'This ticket is blocked by a rule that cannot be changed from the board.',
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      planTicketDrop(testCase.ticket, testCase.target),
      testCase.want,
      testCase.name,
    );
  }
});
