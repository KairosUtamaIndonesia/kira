import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { memoryFor, memoryIn, memoryRuns, type MemoryAnswer } from './memory.ts';

/**
 * What the server said, queued for each call the keeper makes.
 *
 * The keeper is exercised without a server: what it does with an answer is the
 * part worth testing, and an answer is a thing a test can hand it.
 */
function answers(...said: MemoryAnswer[]) {
  const queue = [...said];
  const asked: { key: string; decided?: { enabled: boolean; chosen: string | null } }[] = [];

  return {
    asked,
    read: async (key: string) => {
      asked.push({ key });
      return queue.shift() ?? ({ kind: 'unavailable' } as const);
    },
    write: async (key: string, decided: { enabled: boolean; chosen: string | null }) => {
      asked.push({ key, decided });
      return queue.shift() ?? ({ kind: 'unavailable' } as const);
    },
  };
}

/** A reading, as the server answers one. */
const SAID = { enabled: false, chosen: 'second-model', recommended: 'first-model' };

describe('what a person decided about memory', () => {
  test('is read once and held, so nothing has to ask twice', async () => {
    const server = answers({ kind: 'ok', body: SAID });
    const memory = memoryFor({ token: async () => 'a-key', ...server });

    assert.equal(memory.current(), null);
    assert.deepEqual(await memory.refresh(), SAID);
    assert.deepEqual(memory.current(), SAID);
    assert.deepEqual(server.asked, [{ key: 'a-key' }]);
  });

  test('stands as it was when the server cannot be asked', async () => {
    const server = answers({ kind: 'ok', body: SAID }, { kind: 'unavailable' });
    const memory = memoryFor({ token: async () => 'a-key', ...server });

    await memory.refresh();
    // The second ask fails: "I could not ask" is not "you decided nothing", so the
    // reading stands rather than being emptied.
    assert.deepEqual(await memory.refresh(), SAID);
  });

  test('is nothing at all on a machine with no key', async () => {
    const server = answers({ kind: 'ok', body: SAID });
    let key: string | null = 'a-key';
    const memory = memoryFor({ token: async () => key, ...server });

    await memory.refresh();
    key = null;

    // Signed out is the one case where the reading is dropped: there is no longer a
    // person whose settings these are.
    assert.equal(await memory.refresh(), null);
    assert.equal(memory.current(), null);
  });

  test('is changed by writing through, and holding what the server answered', async () => {
    const server = answers({ kind: 'ok', body: SAID });
    const memory = memoryFor({ token: async () => 'a-key', ...server });

    const saved = await memory.save({ enabled: false, chosen: 'second-model' });

    assert.deepEqual(saved, SAID);
    assert.deepEqual(memory.current(), SAID);
    assert.deepEqual(server.asked, [
      { key: 'a-key', decided: { enabled: false, chosen: 'second-model' } },
    ]);
  });

  test('fails with the server’s own words when it refuses the change', async () => {
    const server = answers({ kind: 'refused', message: 'The pool is not offering nope.' });
    const memory = memoryFor({ token: async () => 'a-key', ...server });

    // The refusal is the server's to word: it is the party that knows why, and a
    // person reading "that could not be saved" learns nothing they can act on.
    await assert.rejects(
      memory.save({ enabled: true, chosen: 'nope' }),
      new Error('The pool is not offering nope.'),
    );
    assert.equal(memory.current(), null);
  });

  test('is not believed when the server answers with something else', () => {
    // A body that is not settings is no settings: the window would rather show
    // nothing than draw a switch from a shape the server never promised.
    assert.equal(memoryIn({ chosen: 'first-model' }), null);
    assert.equal(memoryIn({ enabled: true, chosen: 7, recommended: null }), null);
    assert.equal(memoryIn(null), null);

    // Nothing recommended is a server that could not ask its pool, and that is a
    // reading like any other.
    assert.deepEqual(memoryIn({ enabled: true, chosen: null, recommended: null }), {
      enabled: true,
      chosen: null,
      recommended: null,
    });
  });
});

describe('whether memory runs', () => {
  test('is on for a session that was handed nothing to read', () => {
    // A machine that has not been told what was decided runs the way the server's
    // own default does, which is memory running — so a session booted without the
    // settings is not a session with memory silently off.
    assert.equal(memoryRuns(undefined), true);
    assert.equal(
      memoryRuns(() => null),
      true,
    );
  });

  test('is off only when somebody said so', () => {
    assert.equal(
      memoryRuns(() => ({ enabled: false, chosen: null, recommended: null })),
      false,
    );
    assert.equal(
      memoryRuns(() => ({ enabled: true, chosen: 'a-model', recommended: null })),
      true,
    );
  });
});
