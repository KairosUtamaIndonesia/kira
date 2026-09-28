import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deliveriesFor, type DeliveryAudit, type PullRequests } from './delivery/delivery.ts';
import type { Worktrees } from './workspace/worktrees.ts';

const workspace = {
  id: 'workspace-1',
  ticketId: 'ticket-1',
  repository: 'owner/kira',
  baseBranch: 'main',
  branch: 'kira-1-delivery',
};

function worktrees(result: Awaited<ReturnType<Worktrees['mergeSpec']>>): Worktrees {
  return {
    prepareSpec: async () => workspace.baseBranch,
    mergeSpec: async () => result,
    make: async () => null,
    drop: async () => {},
    changed: async () => null,
    diff: async () => null,
  };
}

function recorder(audits: DeliveryAudit[]) {
  return {
    record: async (audit: DeliveryAudit): Promise<void> => {
      audits.push(audit);
    },
  };
}

const noPullRequest: PullRequests = {
  create: async () => ({ refused: 'provider unavailable' }),
};

test('a local merge records delivery only after the worktree seam reports success', async () => {
  const audits: DeliveryAudit[] = [];
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'merged' }),
    pullRequests: noPullRequest,
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'local-merge',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.deepEqual(result, {
    workspaceId: 'workspace-1',
    path: 'local-merge',
    outcome: 'delivered',
    reference: 'main',
  });
  assert.deepEqual(audits, [result]);
});

test('a merge conflict is recorded as refused and never as a successful delivery', async () => {
  const audits: DeliveryAudit[] = [];
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'conflict', reason: 'conflicting files: src/app.ts' }),
    pullRequests: noPullRequest,
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'local-merge',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.equal(result.outcome, 'refused');
  assert.equal(result.reference, null);
  assert.equal(result.details, 'conflicting files: src/app.ts');
  assert.deepEqual(audits, [result]);
});

test('a pull request refusal keeps the audit outcome refused', async () => {
  const audits: DeliveryAudit[] = [];
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'merged' }),
    pullRequests: noPullRequest,
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'pull-request',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.equal(result.outcome, 'refused');
  assert.equal(result.details, 'provider unavailable');
  assert.deepEqual(audits, [result]);
});

test('a created pull request preserves its reference and URL for the issue audit', async () => {
  const audits: DeliveryAudit[] = [];
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'merged' }),
    pullRequests: {
      create: async () => ({ reference: '#42', url: 'https://github.com/owner/kira/pull/42' }),
    },
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'pull-request',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.deepEqual(result, {
    workspaceId: 'workspace-1',
    path: 'pull-request',
    outcome: 'delivered',
    reference: '#42',
    url: 'https://github.com/owner/kira/pull/42',
  });
  assert.deepEqual(audits, [result]);
});
