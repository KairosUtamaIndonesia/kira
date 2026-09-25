import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ExecutionWorkspace, Ticket, TicketRun } from '../../preload/bridge.ts';
import {
  executionPreviewLabel,
  executionStatusLabel,
  executionWorkspaceView,
} from './executionWorkspace.ts';

const workspace: ExecutionWorkspace = {
  id: 'workspace-1',
  ticketId: 'ticket-1',
  repository: '/work/kira',
  baseBranch: 'main',
  branch: 'fnd-1-execution',
  agentConfig: 'default',
  createdAt: '2026-09-25T00:00:00.000Z',
};

const run = (overrides: Partial<TicketRun> = {}): TicketRun => ({
  id: 'run-1',
  ticketId: workspace.ticketId,
  workerId: 'worker-1',
  startedAt: '2026-09-25T00:01:00.000Z',
  endedAt: null,
  branch: workspace.branch,
  stoppedBecause: null,
  changed: null,
  checks: null,
  made: null,
  verdict: null,
  ...overrides,
});

function ticket(runs: TicketRun[]): Pick<Ticket, 'runs'> {
  return { runs };
}

test('an execution workspace is starting before its first run', () => {
  const view = executionWorkspaceView(workspace, ticket([]));

  assert.equal(view.status, 'starting');
  assert.equal(executionStatusLabel(view.status), 'Starting');
  assert.equal(view.run, null);
  assert.deepEqual(view.processes, []);
});

test('a running workspace exposes its branch and process checks without claiming success', () => {
  const view = executionWorkspaceView(
    workspace,
    ticket([run({ checks: ['bun test', 'bun run typecheck'] })]),
  );

  assert.equal(view.status, 'running');
  assert.deepEqual(view.processes, ['bun test', 'bun run typecheck']);
  assert.equal(view.changed, null);
});

test('a completed workspace exposes changed work', () => {
  const view = executionWorkspaceView(
    workspace,
    ticket([
      run({
        endedAt: '2026-09-25T00:10:00.000Z',
        changed: 'apps/desktop/src/renderer/src/executionWorkspace.ts',
      }),
    ]),
  );

  assert.equal(view.status, 'completed');
  assert.equal(view.changed, 'apps/desktop/src/renderer/src/executionWorkspace.ts');
});

test('a failed workspace stays failed even when it has a partial branch', () => {
  const view = executionWorkspaceView(
    workspace,
    ticket([run({ endedAt: '2026-09-25T00:10:00.000Z', stoppedBecause: 'The agent stopped.' })]),
  );

  assert.equal(view.status, 'failed');
  assert.equal(executionStatusLabel(view.status), 'Failed');
});

test('a workspace with no preview says so instead of presenting stale success', () => {
  const view = executionWorkspaceView(
    workspace,
    ticket([run({ endedAt: '2026-09-25T00:10:00.000Z' })]),
  );

  assert.equal(view.preview, null);
  assert.equal(executionPreviewLabel(view.preview), 'No development preview is available.');
});
