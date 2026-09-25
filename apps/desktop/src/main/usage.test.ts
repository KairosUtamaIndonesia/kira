import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { usageFor, usageIn, type UsageAnswer } from './usage.ts';

/** A reading as the server sends one, with only what a case here cares about. */
function reading(parts: { allowance?: number; used?: number; warned?: boolean } = {}) {
  return { allowance: 20_000_000, used: 0, warned: false, ...parts };
}

test('a reading the server sent is the reading the window shows', () => {
  assert.deepEqual(usageIn(reading({ used: 12_345_678, warned: true })), {
    allowance: 20_000_000,
    used: 12_345_678,
    warned: true,
  });
});

test('a body that is not a reading is no reading at all', () => {
  // Each of these is something a server could answer with by accident — a
  // gateway's HTML, an error envelope, a field that moved — and none of them is a
  // number the window should draw.
  assert.equal(usageIn(null), null);
  assert.equal(usageIn('<html>bad gateway</html>'), null);
  assert.equal(usageIn({ error: { code: 'KEY_NOT_FOUND' } }), null);
  assert.equal(usageIn({ allowance: '20000000', used: 12 }), null);
  assert.equal(usageIn({ allowance: 20_000_000 }), null);
});

test('a warning is only a warning when the server says so', () => {
  assert.equal(usageIn(reading({ warned: true }))?.warned, true);
  // A server that answered with something that is not a boolean is not warning
  // anybody: the threshold lives with the allowance, on the server's side.
  assert.equal(usageIn({ allowance: 20_000_000, used: 1, warned: 'yes' })?.warned, false);
  assert.equal(usageIn(reading())?.warned, false);
});

test('a machine that has not signed in has no reading to show', async () => {
  const asked: string[] = [];
  const usage = usageFor({
    token: async () => null,
    read: async (key) => {
      asked.push(key);
      return { kind: 'ok', body: reading() };
    },
  });

  assert.equal(await usage.refresh(), null);
  assert.equal(usage.current(), null);
  // Nothing to ask with, so nothing was asked.
  assert.deepEqual(asked, []);
});

test('a server that cannot be asked leaves the reading standing', async () => {
  let answer: UsageAnswer = { kind: 'ok', body: reading({ used: 5_000_000 }) };
  const usage = usageFor({ token: async () => 'device-key', read: async () => answer });

  assert.deepEqual(await usage.refresh(), {
    allowance: 20_000_000,
    used: 5_000_000,
    warned: false,
  });

  // Unreachable, then something that is not a reading: neither is "you have used
  // nothing", so the number the window is showing does not move.
  answer = { kind: 'unavailable' };
  assert.equal((await usage.refresh())?.used, 5_000_000);

  answer = { kind: 'ok', body: { nothing: 'useful' } };
  assert.equal((await usage.refresh())?.used, 5_000_000);
  assert.equal(usage.current()?.used, 5_000_000);
});

test('every new reading is heard, and stopping is a thing you can do', async () => {
  let body = reading({ used: 1 });
  const usage = usageFor({
    token: async () => 'device-key',
    read: async () => ({ kind: 'ok', body }),
  });

  const heard: (number | undefined)[] = [];
  const stop = usage.onChange((heardReading) => heard.push(heardReading?.used));

  await usage.refresh();
  body = reading({ used: 2 });
  await usage.refresh();
  stop();
  body = reading({ used: 3 });
  await usage.refresh();

  assert.deepEqual(heard, [1, 2]);
  assert.equal(usage.current()?.used, 3);
});
