import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ExecutionDevServers } from './devServer.ts';

async function waitFor<T>(read: () => T, ready: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 5000;
  let value = read();
  while (!ready(value)) {
    if (Date.now() > end) throw new Error('Timed out waiting for development server output.');
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  return value;
}

test('a workspace dev server retains its logs, exposes only loopback preview URLs, and stops', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'kira-dev-server-'));
  const servers = new ExecutionDevServers();
  try {
    const start = servers.start(
      'workspace-1',
      checkout,
      `${JSON.stringify(process.execPath)} -e "console.log('ready https://not-local.example/ http://localhost:4173/'); setInterval(() => {}, 1000)"`,
    );
    assert.equal(start.running, true);

    const ready = await waitFor(
      () => servers.read('workspace-1'),
      (snapshot) => snapshot.previewUrl !== null,
    );
    assert.match(ready.output, /ready/);
    assert.equal(ready.previewUrl, 'http://localhost:4173/');
    assert.equal(servers.read('missing').running, false);
    const stopped = servers.stop('workspace-1');
    assert.equal(stopped.running, false);
  } finally {
    servers.stopAll();
    await rm(checkout, { recursive: true, force: true });
  }
});
