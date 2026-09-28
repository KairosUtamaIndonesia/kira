import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  deliveriesFor,
  latestRunForBranchIsAccepted,
  type DeliveryAudit,
  type PullRequests,
} from './delivery/delivery.ts';
import type { Worktrees } from './workspace/worktrees.ts';

const workspace = {
  id: 'workspace-1',
  ticketId: 'ticket-1',
  repository: 'owner/kira',
  checkout: '/execution/workspace-1',
  baseBranch: 'main',
  branch: 'kira-1-delivery',
};

function worktrees(result: Awaited<ReturnType<Worktrees['mergeLocal']>>): Worktrees {
  return {
    prepareSpec: async () => workspace.baseBranch,
    mergeSpec: async () => result,
    mergeLocal: async () => result,
    make: async () => null,
    drop: async () => {},
    changed: async () => null,
    diff: async () => null,
    isClean: async () => true,
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
  merge: async () => ({ refused: 'provider unavailable' }),
};

test('delivery approval belongs to the newest run on that branch', () => {
  const earlierAccepted = {
    id: 'run-1',
    branch: 'kira-1-delivery',
    startedAt: '2026-09-28T10:00:00.000Z',
    verdict: 'accepted',
  } as const;
  const cases = [
    { name: 'accepted latest run', runs: [earlierAccepted], want: true },
    {
      name: 'sent-back run supersedes an older approval',
      runs: [
        earlierAccepted,
        {
          ...earlierAccepted,
          id: 'run-2',
          startedAt: '2026-09-28T11:00:00.000Z',
          verdict: 'sent-back',
        },
      ],
      want: false,
    },
    {
      name: 'unjudged run supersedes an older approval',
      runs: [
        earlierAccepted,
        { ...earlierAccepted, id: 'run-2', startedAt: '2026-09-28T11:00:00.000Z', verdict: null },
      ],
      want: false,
    },
    {
      name: 'another branch does not supersede this workspace approval',
      runs: [
        earlierAccepted,
        { ...earlierAccepted, id: 'run-2', branch: 'other-branch', verdict: 'sent-back' },
      ],
      want: true,
    },
    { name: 'no run on this branch', runs: [], want: false },
  ] satisfies {
    name: string;
    runs: Parameters<typeof latestRunForBranchIsAccepted>[0];
    want: boolean;
  }[];

  for (const { name, runs, want } of cases) {
    assert.equal(latestRunForBranchIsAccepted(runs, workspace.branch), want, name);
  }
});

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

test('delivery refuses uncommitted execution-workspace changes instead of omitting them', async () => {
  const audits: DeliveryAudit[] = [];
  const worktree = worktrees({ kind: 'merged' });
  worktree.isClean = async (folder) => folder !== workspace.checkout;
  const delivery = deliveriesFor({
    worktrees: worktree,
    pullRequests: noPullRequest,
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'local-merge',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.details ?? '', /uncommitted changes/);
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
      merge: async () => ({ reference: '#42' }),
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

test('merging a pull request records success only after GitHub confirms the merge', async () => {
  const audits: DeliveryAudit[] = [];
  let mergedBranch = '';
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'merged' }),
    pullRequests: {
      create: async () => ({ refused: 'not used' }),
      merge: async ({ branch }) => {
        mergedBranch = branch;
        return { reference: '#42' };
      },
    },
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'merge-pull-request',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.deepEqual(result, {
    workspaceId: 'workspace-1',
    path: 'merge-pull-request',
    outcome: 'delivered',
    reference: '#42',
  });
  assert.equal(mergedBranch, workspace.branch);
  assert.deepEqual(audits, [result]);
});

test('a pull request merge refusal is recorded without claiming delivery', async () => {
  const audits: DeliveryAudit[] = [];
  const delivery = deliveriesFor({
    worktrees: worktrees({ kind: 'merged' }),
    pullRequests: {
      create: async () => ({ refused: 'not used' }),
      merge: async () => ({ refused: 'no open pull request for branch' }),
    },
    recorder: recorder(audits),
  });

  const result = await delivery.deliver(workspace, {
    path: 'merge-pull-request',
    title: 'Deliver',
    body: 'Issue context',
  });

  assert.equal(result.outcome, 'refused');
  assert.equal(result.details, 'no open pull request for branch');
  assert.deepEqual(audits, [result]);
});
