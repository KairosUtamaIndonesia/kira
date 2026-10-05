import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMutationQueue } from './gitQueue.ts';

/** A gate a test opens by hand, so two commands can be made to overlap. */
function gate() {
  let open: () => void = () => undefined;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, waited };
}

test('commands on one folder run one at a time, in the order they arrived', async () => {
  const queue = createMutationQueue();
  const first = gate();
  const ran: string[] = [];

  const one = queue('a', async () => {
    ran.push('one:start');
    await first.waited;
    ran.push('one:end');
  });
  const two = queue('a', async () => {
    ran.push('two');
  });

  // The second may not have started while the first is held open.
  await Promise.resolve();
  assert.deepEqual(ran, ['one:start']);

  first.open();
  await Promise.all([one, two]);
  assert.deepEqual(ran, ['one:start', 'one:end', 'two']);
});

test('commands on different folders do not wait on each other', async () => {
  const queue = createMutationQueue();
  const held = gate();
  const ran: string[] = [];

  const blocked = queue('a', async () => {
    await held.waited;
    ran.push('a');
  });
  const free = queue('b', async () => {
    ran.push('b');
  });

  await free;
  assert.deepEqual(ran, ['b']);

  held.open();
  await blocked;
  assert.deepEqual(ran, ['b', 'a']);
});

test('a command that fails does not stop the next one', async () => {
  const queue = createMutationQueue();
  const ran: string[] = [];

  const failed = queue('a', async () => {
    ran.push('failed');
    throw new Error('no');
  });

  await assert.rejects(failed, /no/);

  await queue('a', async () => {
    ran.push('next');
  });
  assert.deepEqual(ran, ['failed', 'next']);
});
