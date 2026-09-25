import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CatalogModel } from '@foundry/server/contract';
import { tempDir } from '../test-support/temp.ts';
import { foundryModels, type CatalogAnswer } from './models.ts';

// Hermetic: pi reads `PI_CODING_AGENT_DIR` for credentials and `HOME` for the
// global skills source, so neither leaks in from the developer's machine.
process.env['HOME'] = tempDir('foundry-models-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('foundry-models-agent-dir-');

const SERVER = 'http://localhost:4100';

const SERVED: CatalogModel = {
  id: 'served-model',
  name: 'Served Model',
  contextWindow: 200_000,
  maxOutput: 8192,
  input: ['text', 'image'],
  reasoning: true,
};

/** The catalog a server answers with when a test does not say otherwise. */
const OFFERED: CatalogModel[] = [SERVED];

/** A second model, whose id sorts *before* `served-model`'s. */
const ALSO: CatalogModel = { id: 'also-offered', name: 'Also Offered' };

/** A model the server was listing, and then stopped. */
const RETIRED: CatalogModel = { id: 'retired-model', name: 'Retired Model' };

/** A path to a cache that does not exist yet, as a machine that has never asked. */
function freshCache(): string {
  return join(tempDir('foundry-models-cache-'), 'models.json');
}

/** A module over a temp cache, and a server that answers whatever the test says. */
function modelsFor(
  options: { answer?: () => CatalogAnswer; token?: string | null; cache?: string } = {},
) {
  const asked: string[] = [];
  const cachePath = options.cache ?? freshCache();

  const models = foundryModels({
    server: SERVER,
    cachePath,
    token: async () => (options.token === undefined ? 'device-key' : options.token),
    catalog: async (token) => {
      asked.push(token);
      return options.answer?.() ?? { kind: 'ok', body: { models: OFFERED } };
    },
  });

  return { models, asked, cachePath };
}

test('a session runs on what the server offered, in pi’s terms', async () => {
  const { models, asked, cachePath } = modelsFor();

  await models.refresh();
  const choice = await models.preferred();

  // The provider is Foundry's own id, and the address is the server rather than
  // anything on this machine: pi has no credential for this id to fall back to.
  assert.equal(choice?.model.provider, 'foundry');
  assert.equal(choice?.model.baseUrl, `${SERVER}/v1`);
  assert.equal(choice?.model.id, 'served-model');
  assert.equal(choice?.model.name, 'Served Model');
  assert.equal(choice?.model.contextWindow, 200_000);
  assert.equal(choice?.model.maxTokens, 8192);
  assert.deepEqual(choice?.model.input, ['text', 'image']);
  assert.equal(choice?.model.reasoning, true);

  // The pool states no prices, and a made-up one would be a number somebody acts
  // on. Zero is pi's own way of saying the price is unknown.
  assert.equal(choice?.model.cost.input, 0);
  assert.equal(choice?.model.cost.output, 0);

  // Asked with the key this device holds, and written down for the next launch.
  assert.deepEqual(asked, ['device-key']);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).models[0].id, 'served-model');
});

test('the models on offer are all of them, in the server’s order', async () => {
  const { models } = modelsFor({
    answer: () => ({ kind: 'ok', body: { models: [SERVED, ALSO] } }),
  });

  await models.refresh();

  // The order is the server's, which is the pool's own ranking of what it can
  // serve — kept rather than sorted by id, because that ranking is the only
  // thing that says which model a person should be given, and `also-offered`
  // sorts before `served-model`.
  assert.deepEqual(
    (await models.catalog()).map((each) => each.id),
    ['served-model', 'also-offered'],
  );
  assert.equal((await models.preferred())?.model.id, 'served-model');
});

test('a model the server stops offering is not one to run on', async () => {
  let listing: CatalogModel[] = [SERVED, RETIRED];
  const { models } = modelsFor({ answer: () => ({ kind: 'ok', body: { models: listing } }) });

  await models.refresh();
  assert.equal((await models.find(RETIRED.id))?.model.id, 'retired-model');

  listing = [SERVED];
  await models.refresh();

  // Not found rather than remembered, because a chat that was on it has to fall
  // back: a session built on a model the server has stopped offering is a
  // request that fails, and finding it here would be this module saying
  // otherwise.
  assert.equal(await models.find(RETIRED.id), null);
  assert.equal((await models.find(SERVED.id))?.model.id, 'served-model');
});

test('a model the server said little about is run on pi’s own defaults', async () => {
  const { models } = modelsFor({
    answer: () => ({ kind: 'ok', body: { models: [{ id: 'bare' }] } }),
  });

  await models.refresh();
  const choice = await models.preferred();

  assert.equal(choice?.model.id, 'bare');
  assert.equal(choice?.model.name, 'bare');
  assert.equal(choice?.model.reasoning, false);
  assert.deepEqual(choice?.model.input, ['text']);
  assert.equal(choice?.model.contextWindow, 128_000);
  assert.equal(choice?.model.maxTokens, 16_384);
});

test('a cold start runs on what the server last served', async () => {
  const cache = freshCache();
  await modelsFor({ cache }).models.refresh();

  // A second module, as a later launch is: nothing in memory, no network, only
  // the file the first one left.
  const later = modelsFor({ cache, answer: () => ({ kind: 'unavailable' }) });
  const choice = await later.models.preferred();

  assert.deepEqual(later.asked, [], 'nothing was asked of the server');
  assert.equal(choice?.model.id, 'served-model');
});

test('every session runs on the one runtime', async () => {
  const { models } = modelsFor();
  await models.refresh();

  const first = await models.preferred();
  const second = await models.preferred();

  assert.equal(first?.runtime, second?.runtime);
});

test('a refresh puts what the server now offers into use', async () => {
  let offering: CatalogModel[] = [{ id: 'first-model' }];
  const { models } = modelsFor({ answer: () => ({ kind: 'ok', body: { models: offering } }) });

  await models.refresh();
  assert.equal((await models.preferred())?.model.id, 'first-model');

  offering = [{ id: 'second-model' }];
  await models.refresh();

  // pi replaces its list with what a refresh returns, so the model in use has to
  // change with it: a refresh that only wrote the cache would leave a session
  // running on a model the server had stopped offering.
  assert.equal((await models.preferred())?.model.id, 'second-model');
});

test('a machine that has not signed in asks the server nothing', async () => {
  const { models, asked, cachePath } = modelsFor({ token: null });

  await models.refresh();

  assert.deepEqual(asked, [], 'there is no key to ask with');
  assert.equal(await models.preferred(), null);
  assert.equal(existsSync(cachePath), false);

  // And no key is left lying in the environment for pi to resolve.
  assert.equal(process.env['FOUNDRY_TOKEN'], undefined);
});

test('the key this device holds is where pi looks for it', async () => {
  const { models } = modelsFor({ token: 'device-key' });

  await models.preferred();

  assert.equal(process.env['FOUNDRY_TOKEN'], 'device-key');
});

test('a server that cannot be asked leaves the remembered models alone', async () => {
  const cache = freshCache();
  writeFileSync(cache, JSON.stringify({ models: OFFERED }));

  const { models } = modelsFor({ cache, answer: () => ({ kind: 'unavailable' }) });
  await models.refresh();

  // "I could not ask" and "there are none" are different facts, and only the
  // second one is worth forgetting a working list over.
  assert.equal((await models.preferred())?.model.id, 'served-model');
  assert.equal(JSON.parse(readFileSync(cache, 'utf8')).models[0].id, 'served-model');
});

test('a server offering nothing empties the catalog rather than keeping it', async () => {
  const cache = freshCache();
  writeFileSync(cache, JSON.stringify({ models: OFFERED }));

  const { models } = modelsFor({ cache, answer: () => ({ kind: 'ok', body: { models: [] } }) });
  await models.refresh();

  assert.equal(await models.preferred(), null);
  assert.deepEqual(JSON.parse(readFileSync(cache, 'utf8')), { models: [] });
});

const REMEMBERED: { name: string; written: string; expected: string | null }[] = [
  { name: 'a catalog', written: JSON.stringify({ models: OFFERED }), expected: 'served-model' },
  {
    name: 'an entry that names nothing but a model',
    written: '{"models":[{"id":"bare"}]}',
    expected: 'bare',
  },
  { name: 'something that is not JSON', written: 'this was never a catalog', expected: null },
  { name: 'a document with no models in it', written: '{"data":[]}', expected: null },
  {
    name: 'an entry that names no model',
    written: '{"models":[{"name":"Nameless"}]}',
    expected: null,
  },
  { name: 'an empty file', written: '', expected: null },
];

for (const remembered of REMEMBERED) {
  test(`a cache holding ${remembered.name} is read as ${remembered.expected ?? 'nothing'}`, async () => {
    const cache = freshCache();
    writeFileSync(cache, remembered.written);

    const { models, asked } = modelsFor({ cache });

    assert.equal((await models.preferred())?.model.id ?? null, remembered.expected);
    assert.deepEqual(asked, [], 'reading what was written down never asks the server');
  });
}
