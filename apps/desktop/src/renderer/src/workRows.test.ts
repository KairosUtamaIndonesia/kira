import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, Clock, Play } from 'lucide-react';
import type { Ticket, TicketStatus } from '../../preload/bridge.ts';
import {
  age,
  byName,
  firstIn,
  holding,
  inStatus,
  isUnbrokenSpec,
  statusIcon,
  statusOf,
  suggestPrefix,
  when,
} from './workRows.ts';

function ticket(
  id: string,
  status: TicketStatus = 'ready',
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    projectId: 'project-1',
    name: `FND-${id}`,
    number: 1,
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
  };
}

test('Blocked is displayed from open blockers without changing stored status', () => {
  const held = ticket('1', 'running', { blocked: true });
  assert.equal(statusOf(held), 'blocked');
  assert.equal(held.status, 'running');
  assert.deepEqual(inStatus([held, ticket('2')], 'blocked'), [held]);
  assert.equal(firstIn([held], 'blocked'), held);
  assert.equal(holding(held).icon, Clock);
});

test('each stored status has its expected icon', () => {
  const cases = [
    ['draft', CircleDashed],
    ['ready', Play],
    ['running', CircleDashed],
    ['needs-review', CircleHelp],
    ['done', CircleCheck],
    ['wont-do', CircleAlert],
    ['blocked', Clock],
  ] as const;
  for (const [status, icon] of cases) assert.equal(statusIcon(status), icon, status);
});

test('time labels are calculated from the supplied clock', () => {
  const now = Date.parse('2026-01-01T02:00:00.000Z');
  assert.equal(age('2026-01-01T01:30:00.000Z', now), '30m');
  assert.equal(age('2026-01-01T00:00:00.000Z', now), '2h');
  assert.equal(when('2026-01-01T01:00:00.000Z', now), '1 hour ago');
  assert.equal(when('2026-01-01T02:00:00.000Z', now), 'just now');
});

test('names match whole ticket ids without regard to case or surrounding space', () => {
  const held = ticket('1');
  assert.equal(byName([held], ' fnd-1 '), held);
  assert.equal(byName([held], 'FND-10'), undefined);
  assert.equal(byName([held], '  '), undefined);
});

test('spec completeness and project prefix suggestions stay bounded', () => {
  assert.equal(isUnbrokenSpec(ticket('1', 'draft', { kind: 'spec' })), true);
  assert.equal(isUnbrokenSpec(ticket('1', 'draft')), false);
  assert.equal(suggestPrefix('kira work'), 'KIRAWO');
  assert.equal(suggestPrefix('123'), 'F123');
  assert.equal(suggestPrefix('!!!'), 'PROJ');
});
