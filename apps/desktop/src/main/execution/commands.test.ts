import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runExecutionCommand } from './commands.ts';

test('commands run inside the selected checkout and report stdout, stderr, and exit status', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'kira-execution-command-'));
  try {
    const result = await runExecutionCommand(checkout, 'printf stdout; printf stderr >&2; exit 7');
    assert.equal(result.command, 'printf stdout; printf stderr >&2; exit 7');
    assert.equal(result.output, 'stdout\nstderr');
    assert.equal(result.exitCode, 7);
    await runExecutionCommand(checkout, 'printf workspace > command-output.txt');
    assert.equal(await readFile(join(checkout, 'command-output.txt'), 'utf8'), 'workspace');
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});
