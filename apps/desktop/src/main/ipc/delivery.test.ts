import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deliveryHandlers } from './delivery.ts';

test('delivery names an issue, execution workspace, and supported path', async () => {
  const asked: string[] = [];
  const handlers = deliveryHandlers({
    deliver: async (ticketId, workspaceId, path) => {
      asked.push(`${ticketId}/${workspaceId}/${path}`);
      return { workspaceId, path, outcome: 'delivered', reference: 'main' };
    },
  });

  assert.deepEqual(await handlers.deliver('ticket-1', 'workspace-1', 'local-merge'), {
    ok: true,
    value: {
      workspaceId: 'workspace-1',
      path: 'local-merge',
      outcome: 'delivered',
      reference: 'main',
    },
  });
  assert.deepEqual(await handlers.deliver('', 'workspace-1', 'local-merge'), {
    ok: false,
    error: 'Delivery needs an issue and execution workspace.',
  });
  assert.deepEqual(await handlers.deliver('ticket-1', 'workspace-1', 'unknown'), {
    ok: false,
    error: 'Delivery uses a local merge, pull request, or pull request merge.',
  });
  assert.equal((await handlers.deliver('ticket-1', 'workspace-1', 'merge-pull-request')).ok, true);
  assert.deepEqual(asked, [
    'ticket-1/workspace-1/local-merge',
    'ticket-1/workspace-1/merge-pull-request',
  ]);
});
