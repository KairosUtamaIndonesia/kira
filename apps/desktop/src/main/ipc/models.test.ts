import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ModelOption } from '../../preload/bridge.ts';
import { modelHandlers } from './models.ts';

const OFFERED: ModelOption[] = [
  { id: 'gpt-6-astra', name: 'GPT 6.0 Astra' },
  { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
];

/** Handlers over a main process that records what was chosen and answers what it is told. */
function handlersFor(
  options: { offered?: () => Promise<ModelOption[]>; choose?: (id: string) => Promise<void> } = {},
) {
  const chosen: string[] = [];

  return {
    chosen,
    handlers: modelHandlers({
      offered: options.offered ?? (async () => OFFERED),
      choose:
        options.choose ??
        (async (modelId) => {
          chosen.push(modelId);
        }),
    }),
  };
}

test('the window is told the models Kira offers, in the order it offers them', async () => {
  const { handlers } = handlersFor();

  // The order is the pool's ranking rather than anything decided here, so it
  // crosses as it arrived: a picker that sorted these would be saying which
  // model is best, which is the server's to say (apps/server/src/pool.ts).
  assert.deepEqual(await handlers.load(), { ok: true, value: OFFERED });
});

test('choosing a model reaches the chat on screen', async () => {
  const { handlers, chosen } = handlersFor();

  assert.deepEqual(await handlers.choose('gpt-5.6-luna'), { ok: true, value: null });
  assert.deepEqual(chosen, ['gpt-5.6-luna']);
});

test('a choice that names no model is refused before it reaches a session', async () => {
  const { handlers, chosen } = handlersFor();

  for (const nothingNamed of [undefined, null, 42, '', { id: 'gpt-6-astra' }]) {
    assert.deepEqual(await handlers.choose(nothingNamed), {
      ok: false,
      error: 'A model needs an id.',
    });
  }

  assert.deepEqual(chosen, [], 'nothing was run on');
});

test('a choice the pool does not offer is a failure, not a crash', async () => {
  const { handlers } = handlersFor({
    choose: async (modelId) => {
      throw new Error(`Kira is not offering ${modelId}.`);
    },
  });

  assert.deepEqual(await handlers.choose('nope-9'), {
    ok: false,
    error: 'Kira is not offering nope-9.',
  });
});

test('a list that cannot be read is a failure, not a crash', async () => {
  const { handlers } = handlersFor({
    offered: async () => {
      throw new Error('the catalog is not here');
    },
  });

  assert.deepEqual(await handlers.load(), { ok: false, error: 'the catalog is not here' });
});
