import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reflectingWith, type MemoryChoice, type MemorySettings } from '../../preload/bridge.ts';
import { memoryHandlers } from './memory.ts';

const HELD: MemorySettings = { enabled: true, chosen: null, recommended: 'first-model' };

interface Case {
  name: string;
  decided: unknown;
  want: unknown;
}

/**
 * Every way a save can be wrong, and what the window is told about it.
 *
 * The window is an input to be checked rather than a caller to be believed, so each
 * of these is a shape the renderer could send and none of them is a decision. The
 * complaint is one sentence because the renderer has nowhere to put a field name.
 */
const REFUSALS: Case[] = [
  {
    name: 'nothing at all',
    decided: null,
    want: { ok: false, error: 'That is not a memory setting.' },
  },
  {
    name: 'a switch that is not a boolean',
    decided: { enabled: 'no', chosen: null },
    want: { ok: false, error: 'That is not a memory setting.' },
  },
  {
    name: 'a model that is not a name',
    decided: { enabled: true, chosen: 7 },
    want: { ok: false, error: 'That is not a memory setting.' },
  },
  {
    name: 'a model that is an empty name',
    decided: { enabled: true, chosen: '' },
    want: { ok: false, error: 'That is not a memory setting.' },
  },
  {
    name: 'a choice that says neither thing',
    decided: {},
    want: { ok: false, error: 'That is not a memory setting.' },
  },
];

test('the window is told the reading the main process holds', async () => {
  const handlers = memoryHandlers({ current: () => HELD, save: async () => HELD });

  assert.deepEqual(await handlers.load(), { ok: true, value: HELD });
});

test('a machine with no reading answers nothing, which is not the defaults', async () => {
  // Signed out, or the server could not be asked. Both are "I do not know", and a
  // window that drew a switch from either would be inventing somebody's answer.
  const handlers = memoryHandlers({ current: () => null, save: async () => HELD });

  assert.deepEqual(await handlers.load(), { ok: true, value: null });
});

test('a decision is written through, and what is in force comes back', async () => {
  const written: MemoryChoice[] = [];
  const handlers = memoryHandlers({
    current: () => HELD,
    save: async (decided) => {
      written.push(decided);
      return { enabled: decided.enabled, chosen: decided.chosen, recommended: 'first-model' };
    },
  });

  const saved = await handlers.save({ enabled: false, chosen: 'second-model' });

  assert.deepEqual(written, [{ enabled: false, chosen: 'second-model' }]);
  assert.deepEqual(saved, {
    ok: true,
    value: { enabled: false, chosen: 'second-model', recommended: 'first-model' },
  });
});

for (const testCase of REFUSALS) {
  test(`a save of ${testCase.name} is refused, and nothing is written down`, async () => {
    const written: MemoryChoice[] = [];
    const handlers = memoryHandlers({
      current: () => HELD,
      save: async (decided) => {
        written.push(decided);
        return HELD;
      },
    });

    assert.deepEqual(await handlers.save(testCase.decided), testCase.want);
    assert.deepEqual(written, []);
  });
}

test('the server’s refusal is a failure the page can show, in its own words', async () => {
  const handlers = memoryHandlers({
    current: () => HELD,
    save: async () => {
      throw new Error('The pool is not offering nope.');
    },
  });

  // The server is the party that knows why it would not take, and "that could not
  // be saved" would leave a person nothing to act on.
  assert.deepEqual(await handlers.save({ enabled: true, chosen: 'nope' }), {
    ok: false,
    error: 'The pool is not offering nope.',
  });
});

test('what reflects is the choice, or the suggestion when there is none', () => {
  // The rule the page draws by and a compaction runs by, spelled once: a person who
  // has chosen gets their choice, and one who has not gets the suggestion rather
  // than whatever model happens to be first on the list.
  assert.equal(reflectingWith({ enabled: true, chosen: 'mine', recommended: 'theirs' }), 'mine');
  assert.equal(reflectingWith({ enabled: true, chosen: null, recommended: 'theirs' }), 'theirs');
  assert.equal(reflectingWith({ enabled: true, chosen: null, recommended: null }), null);
  assert.equal(reflectingWith(null), null);
});
