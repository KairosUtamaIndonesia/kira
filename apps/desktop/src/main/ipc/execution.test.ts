import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { executionHandlers } from './execution.ts';

function dependencies(
  command: (
    ticket: string,
    workspace: string,
    text: string,
  ) => Promise<{ command: string; output: string; exitCode: number }>,
) {
  return {
    command,
    startDevServer: async () => ({ running: true, output: '', previewUrl: null, exitCode: null }),
    readDevServer: async () => ({ running: true, output: '', previewUrl: null, exitCode: null }),
    stopDevServer: async () => ({ running: false, output: '', previewUrl: null, exitCode: 0 }),
    startTerminal: async () => ({ running: true, output: '', exitCode: null, sequence: 0 }),
    readTerminal: async () => ({ running: true, output: '', exitCode: null, sequence: 0 }),
    writeTerminal: async () => null,
    resizeTerminal: async () => null,
    stopTerminal: async () => ({ running: false, output: '', exitCode: 0, sequence: 1 }),
  };
}

test('workspace command handler validates names and bounds input before dispatch', async () => {
  const dispatched: string[] = [];
  const handlers = executionHandlers(
    dependencies(async (ticket, workspace, command) => {
      dispatched.push(`${ticket}/${workspace}/${command}`);
      return { command, output: 'ok', exitCode: 0 };
    }),
  );

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

test('terminal IPC validates input sizes and dimensions before dispatch', async () => {
  const handlers = executionHandlers(
    dependencies(async (_ticket, _workspace, command) => ({ command, output: '', exitCode: 0 })),
  );
  assert.deepEqual(await handlers.writeTerminal('issue', 'workspace', 'x'.repeat(8193)), {
    ok: false,
    error: 'Terminal input must be 8192 characters or fewer.',
  });
  assert.deepEqual(await handlers.resizeTerminal('issue', 'workspace', 1, 24), {
    ok: false,
    error: 'Terminal dimensions are outside the allowed range.',
  });
  assert.deepEqual(await handlers.resizeTerminal('issue', 'workspace', 100, 30), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await handlers.startTerminal('', 'workspace'), {
    ok: false,
    error: 'A terminal needs an issue and execution workspace.',
  });
});

test('dev server commands are validated and process read or stop requires named resources', async () => {
  const handlers = executionHandlers(
    dependencies(async (_ticket, _workspace, command) => ({ command, output: '', exitCode: 0 })),
  );
  assert.deepEqual(await handlers.startDevServer('issue', 'workspace', ''), {
    ok: false,
    error: 'Enter a command to start the development server.',
  });
  assert.deepEqual(await handlers.readDevServer('', 'workspace'), {
    ok: false,
    error: 'A process log needs an issue and execution workspace.',
  });
  assert.deepEqual(await handlers.stopDevServer('issue', 'workspace'), {
    ok: true,
    value: { running: false, output: '', previewUrl: null, exitCode: 0 },
  });
});
