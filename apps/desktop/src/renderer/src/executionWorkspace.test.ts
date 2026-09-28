import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ExecutionWorkspace, Ticket, TicketRun } from '../../preload/bridge.ts';
import {
  executionPreviewLabel,
  executionStatusLabel,
  executionDiffFiles,
  suggestExecutionBranch,
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

test('a new workspace gets an unused branch suggestion', () => {
  const cases = [
    { name: 'unused issue branch', existing: [], want: 'fnd-1-execution' },
    {
      name: 'next numbered branch when default is already used',
      existing: ['fnd-1-execution'],
      want: 'fnd-1-execution-2',
    },
    {
      name: 'skip numbered branches that are already used',
      existing: ['fnd-1-execution', 'fnd-1-execution-2'],
      want: 'fnd-1-execution-3',
    },
  ];

  for (const { name, existing, want } of cases) {
    assert.equal(suggestExecutionBranch('fnd-1-execution', existing), want, name);
  }
});

test('an execution workspace is not started before its first run', () => {
  const view = executionWorkspaceView(workspace, ticket([]));

  assert.equal(view.status, 'not-started');
  assert.equal(executionStatusLabel(view.status), 'Not started');
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

test('an unrun workspace does not borrow another workspace’s latest run', () => {
  const otherRun = run({ branch: 'feature/another-workspace' });
  const view = executionWorkspaceView(workspace, ticket([otherRun]));

  assert.equal(view.status, 'not-started');
  assert.equal(view.run, null);
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

test('unified diffs are grouped by file and assign reviewable new-side line numbers', () => {
  const cases = [
    {
      name: 'added and context lines',
      diff: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -4,2 +4,3 @@',
        ' kept',
        '-old',
        '+new',
      ].join('\n'),
      want: [
        {
          path: 'src/a.ts',
          lines: [
            ['context', 4],
            ['removed', null],
            ['added', 5],
          ],
        },
      ],
    },
    {
      name: 'new file with no old-side path',
      diff: [
        'diff --git a/new.ts b/new.ts',
        '--- /dev/null',
        '+++ b/new.ts',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ].join('\n'),
      want: [{ path: 'new.ts', lines: [['added', 1]] }],
    },
    { name: 'empty diff', diff: '', want: [] },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      executionDiffFiles(testCase.diff).map((file) => ({
        path: file.path,
        lines: file.lines
          .filter((line) => ['context', 'added', 'removed'].includes(line.kind))
          .map((line) => [line.kind, line.newLine]),
      })),
      testCase.want,
      testCase.name,
    );
  }
});
