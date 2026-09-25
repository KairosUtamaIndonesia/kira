import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Ticket } from '../../preload/bridge.ts';
import {
  canReorderReady,
  DEFAULT_WORK_DISPLAY,
  displayWork,
  groupedWork,
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
