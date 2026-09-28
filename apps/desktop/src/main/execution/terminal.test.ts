import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ExecutionTerminals } from './terminal.ts';

async function waitFor<T>(read: () => T, ready: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 5000;
  let value = read();
  while (!ready(value)) {
    if (Date.now() > end)
      throw new Error(`Timed out waiting for terminal output: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  return value;
}

test('a workspace terminal accepts input, resizes, streams output, and retains scrollback', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'kira-terminal-'));
  const logDirectory = join(checkout, 'logs');
  const events: { workspaceId: string; data: string; running: boolean }[] = [];
  const terminal = new ExecutionTerminals((event) => events.push(event), logDirectory);
  try {
    const start = terminal.start('workspace-1', checkout, process.execPath, [
      '-e',
      `process.stdin.resume(); process.stdin.once('data', data => { process.stdout.write('received:' + data.toString().trim() + '\\r\\n'); process.exit(0) }); process.stdout.write('terminal-ready\\r\\n')`,
    ]);
    assert.equal(start.running, true);
    terminal.resize('workspace-1', 100, 30);
    await waitFor(
      () => terminal.read('workspace-1'),
      (snapshot) => snapshot.output.includes('terminal-ready'),
    );
    terminal.write('workspace-1', 'hello\r');

    const complete = await waitFor(
      () => terminal.read('workspace-1'),
      (snapshot) => !snapshot.running && snapshot.output.includes('received:hello'),
    );
    assert.match(complete.output, /received:hello/);
    assert.ok(events.some((event) => event.workspaceId === 'workspace-1' && event.data !== ''));
    assert.equal(complete.sequence > 0, true);

    const reopened = new ExecutionTerminals(() => {}, logDirectory).read('workspace-1');
    assert.equal(reopened.running, false);
    assert.match(reopened.output, /received:hello/);
  } finally {
    terminal.stopAll();
    await rm(checkout, { recursive: true, force: true });
  }
});
