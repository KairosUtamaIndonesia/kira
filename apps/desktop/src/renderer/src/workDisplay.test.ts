import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Ticket, TicketStatus } from '../../preload/bridge.ts';
import {
  canReorderReady,
  compareWork,
  DEFAULT_WORK_DISPLAY,
  displayWork,
  groupedWork,
  planTicketDrop,
  readWorkDisplay,
  reorderReady,
  statusLabel,
} from './workDisplay.ts';

function ticket(
  id: string,
  status: TicketStatus = 'ready',
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    projectId: 'project-1',
    name: `FND-${id}`,
    number: Number(id) || 1,
    kind: 'feature',
    title: id,
    body: '',
    criteria: [],
    status,
    blocked: false,
    rank: 0,
    priority: 'none',
    assignee: null,
    tags: [],
    author: null,
    gates: [],
    children: [],
    parent: null,
    subIssues: [],
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    pullRequestUrl: overrides.pullRequestUrl ?? null,
  };
}

test('reads status filters and ignores unknown status values', () => {
  assert.deepEqual(readWorkDisplay('?status=needs-review&owner=assigned&kind=bug'), {
    ...DEFAULT_WORK_DISPLAY,
    status: 'needs-review',
    owner: 'assigned',
    kind: 'bug',
  });
  assert.equal(readWorkDisplay('?band=ready').status, 'all');
  assert.equal(readWorkDisplay('?status=unknown').status, 'all');
});

test('a lane drop writes stored status, while Blocked changes blocker links', () => {
  const cases = [
    { name: 'same displayed state', held: ticket('1'), target: 'ready' as const, want: null },
    {
      name: 'stored status change',
      held: ticket('1', 'draft'),
      target: 'ready' as const,
      want: { kind: 'change-status', status: 'ready' },
    },
    {
      name: 'add a blocker',
      held: ticket('1'),
      target: 'blocked' as const,
      want: { kind: 'add-blocker' },
    },
    {
      name: 'remove a blocker before moving',
      held: ticket('1', 'ready', { blocked: true }),
      target: 'running' as const,
      want: { kind: 'resolve-blockers' },
    },
  ];

  for (const item of cases) {
    assert.deepEqual(planTicketDrop(item.held, item.target), item.want, item.name);
  }
});

test('filters by displayed status, assignee, kind, search, and closed visibility', () => {
  const tickets = [
    ticket('1', 'ready', {
      title: 'Assigned bug',
      kind: 'bug',
      assignee: { id: 'ada', name: 'Ada' },
    }),
    ticket('2', 'running', { blocked: true, title: 'Waiting' }),
    ticket('3', 'done'),
    ticket('4', 'wont-do'),
  ];

  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, status: 'blocked' }).map((each) => each.id),
    ['2'],
  );
  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, owner: 'assigned' }).map((each) => each.id),
    ['1'],
  );
  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, kind: 'bug' }).map((each) => each.id),
    ['1'],
  );
  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, search: 'waiting' }).map((each) => each.id),
    ['2'],
  );
  assert.deepEqual(
    displayWork(tickets, DEFAULT_WORK_DISPLAY).map((each) => each.id),
    ['1', '2'],
  );
  assert.deepEqual(
    displayWork(tickets, { ...DEFAULT_WORK_DISPLAY, showDone: true }).map((each) => each.id),
    ['1', '2', '3', '4'],
  );
});

test('groups by derived status and reorders only unblocked Ready tickets', () => {
  const tickets = [
    ticket('1', 'ready', { rank: 1 }),
    ticket('2', 'ready', { rank: 2, blocked: true }),
    ticket('3', 'ready', { rank: 3 }),
  ];
  assert.deepEqual(
    groupedWork(tickets, 'status').map(({ key }) => key),
    ['ready', 'blocked'],
  );
  assert.deepEqual(
    reorderReady(tickets, '3', '1').map(({ id }) => id),
    ['3', '1'],
  );
  assert.equal(canReorderReady(DEFAULT_WORK_DISPLAY), true);
  assert.equal(canReorderReady({ ...DEFAULT_WORK_DISPLAY, owner: 'assigned' }), false);
  assert.equal(statusLabel('wont-do'), 'Won’t do');
});

test('orders tickets by rank, then by update time', () => {
  const older = ticket('1', 'ready', { rank: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
  const newer = ticket('2', 'ready', { rank: 2, updatedAt: '2026-01-02T00:00:00.000Z' });
  assert.ok(compareWork(older, newer, 'rank') < 0);
  assert.ok(compareWork(newer, older, 'updated') < 0);
});
