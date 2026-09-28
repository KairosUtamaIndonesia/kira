import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { executionHandlers } from './execution.ts';

test('workspace command handler validates names and bounds input before dispatch', async () => {
  const dispatched: string[] = [];
  const handlers = executionHandlers({
    command: async (ticket, workspace, command) => {
      dispatched.push(`${ticket}/${workspace}/${command}`);
      return { command, output: 'ok', exitCode: 0 };
    },
  });

  assert.deepEqual(await handlers.command('issue-1', 'workspace-1', 'bun test'), {
    ok: true,
    value: { command: 'bun test', output: 'ok', exitCode: 0 },
  });
  assert.deepEqual(await handlers.command('issue-1', 'workspace-1', '  '), {
    ok: false,
    error: 'Enter a command to run.',
  });
  assert.deepEqual(await handlers.command('issue-1', 'workspace-1', 'x'.repeat(2001)), {
    ok: false,
    error: 'Commands must be 2000 characters or fewer.',
  });
  assert.deepEqual(dispatched, ['issue-1/workspace-1/bun test']);
});
