/**
 * The memory settings, and the route a person changes them through.
 *
 * Two decisions live here: whether the observational-memory workers run at all,
 * and which model does the reflecting. Which model is *recommended* is a third
 * thing and not a decision — the server suggests one and the person chooses
 * (GH #43) — so a recommendation is never a value anybody has to accept, and the
 * route is careful never to hand back a suggestion where a choice belongs.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { memoryFor, setMemory } from './memory';
import { startFakePool } from './test-support/fake-pool';
import { bearer, boot, closeDatabases, issue, send, user } from './test-support/server';

afterAll(closeDatabases);

/**
 * Three models, because three facts need telling apart: which model the pool puts
 * first, which one a person may choose, and which one the pool does not want
 * offered at all.
 */
const CATALOG = [
  { slug: 'second-model', display_name: 'Second Model', visibility: 'list', priority: 2 },
  { slug: 'first-model', display_name: 'First Model', visibility: 'list', priority: 1 },
  { slug: 'hidden-model', display_name: 'Hidden Model', visibility: 'hide', priority: 0 },
];

/** Where a dead pool is: port 9 is discard, so the connection is refused. */
const NO_POOL = 'http://127.0.0.1:9';

function put(headers: Record<string, string>, body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/** A person with a key, and the pool their server asks. */
async function signedIn(catalog: Record<string, unknown>[] = CATALOG) {
  const pool = await startFakePool({ catalog });
  const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
  const ada = await user(auth);

  return { pool, app, key: (await issue(auth, ada.id, 'workstation')).key };
}

describe('what a person chose about memory', () => {
  test('is nothing until they choose, which is not the same as choosing off', async () => {
    const { database, auth } = await boot();
    const ada = await user(auth);

    // No row is no choice: memory runs until somebody says otherwise, and no model
    // of their own means the recommendation decides (docs/adr/0005-allowances.md is
    // the same shape for an allowance).
    expect(await memoryFor(database, ada.id)).toEqual({ enabled: null, chosen: null });

    await setMemory(database, ada.id, { enabled: false, chosen: 'second-model' });

    expect(await memoryFor(database, ada.id)).toEqual({ enabled: false, chosen: 'second-model' });

    // Setting it again replaces it rather than accumulating: there is one answer to
    // each of the two questions.
    await setMemory(database, ada.id, { enabled: true, chosen: null });

    expect(await memoryFor(database, ada.id)).toEqual({ enabled: true, chosen: null });
  });
});

describe('the memory route', () => {
  test('answers somebody who has chosen nothing with the defaults, and a recommendation', async () => {
    const { pool, app, key } = await signedIn();

    const response = await send(app, '/api/memory', { headers: bearer(key) });

    expect(response.status).toBe(200);

    // Memory runs, nothing has been chosen, and the pool's own first pick is what
    // is suggested. `chosen` is null rather than the suggestion, because nothing
    // has been chosen — a window told otherwise would save the suggestion back as
    // this person's own decision.
    expect(await response.json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: 'first-model',
    });

    await pool.stop();
  });

  test('keeps a choice, and goes on recommending the pool’s own pick', async () => {
    const { pool, app, key } = await signedIn();

    const saved = await send(
      app,
      '/api/memory',
      put(bearer(key), { enabled: false, chosen: 'second-model' }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      enabled: false,
      chosen: 'second-model',
      recommended: 'first-model',
    });

    // Read back from the database rather than remembered in the answer: the
    // settings outlive the process that wrote them.
    const again = await send(app, '/api/memory', { headers: bearer(key) });

    expect(await again.json()).toEqual({
      enabled: false,
      chosen: 'second-model',
      recommended: 'first-model',
    });

    await pool.stop();
  });

  test('forgets a choice the pool has stopped offering, rather than reporting it', async () => {
    const pool = await startFakePool({ catalog: CATALOG });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = (await issue(auth, ada.id, 'workstation')).key;

    // As a pool that has since dropped a model leaves the row: it names one the pool
    // no longer offers, which is what a choice becomes when the pool's credentials
    // or plans change under it. A model no chat can run on is no choice at all, so
    // the answer says none rather than naming one that is gone.
    await setMemory(database, ada.id, { enabled: true, chosen: 'retired-model' });

    expect(await (await send(app, '/api/memory', { headers: bearer(key) })).json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: 'first-model',
    });

    await pool.stop();
  });

  test.each(['hidden-model', 'not-a-model'])(
    'refuses %s, which the pool is not offering, and stores nothing',
    async (model) => {
      const { pool, app, key } = await signedIn();

      const refused = await send(
        app,
        '/api/memory',
        put(bearer(key), { enabled: false, chosen: model }),
      );

      expect(refused.status).toBe(400);
      expect((await refused.json()).error.code).toBe('MODEL_NOT_OFFERED');

      expect(await (await send(app, '/api/memory', { headers: bearer(key) })).json()).toEqual({
        enabled: true,
        chosen: null,
        recommended: 'first-model',
      });

      await pool.stop();
    },
  );

  test('belongs to the person holding the key', async () => {
    const pool = await startFakePool({ catalog: CATALOG });
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const grace = await user(auth, 'grace@company.example');
    const adaKey = (await issue(auth, ada.id, 'workstation')).key;
    const graceKey = (await issue(auth, grace.id, 'workstation')).key;

    await send(app, '/api/memory', put(bearer(adaKey), { enabled: false, chosen: 'second-model' }));

    // Grace chose nothing, so Grace gets the defaults — one person's setting is not
    // the setting.
    expect(await (await send(app, '/api/memory', { headers: bearer(graceKey) })).json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: 'first-model',
    });

    await pool.stop();
  });

  test('turns away a request with no key, reading or writing', async () => {
    const pool = await startFakePool({ catalog: CATALOG });
    const { app } = await boot({}, { url: pool.url, key: 'pool-key' });

    const read = await send(app, '/api/memory');
    const wrote = await send(app, '/api/memory', put({}, { enabled: false, chosen: null }));

    expect(read.status).toBe(401);
    expect(wrote.status).toBe(401);
    expect((await read.json()).error.code).toBe('KEY_NOT_FOUND');

    await pool.stop();
  });

  test('is readable when the pool cannot be asked, and cannot be pointed at a model then', async () => {
    const { app, auth } = await boot({}, { url: NO_POOL, key: 'pool-key' });
    const ada = await user(auth);
    const key = (await issue(auth, ada.id, 'workstation')).key;

    // No recommendation rather than a guess: which model to suggest is the pool's
    // answer to give, and a server that cannot ask it has none.
    expect(await (await send(app, '/api/memory', { headers: bearer(key) })).json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: null,
    });

    // Nothing can say whether the pool has that model, so a choice of model is
    // refused rather than stored on trust.
    const refused = await send(
      app,
      '/api/memory',
      put(bearer(key), { enabled: true, chosen: 'first-model' }),
    );

    expect(refused.status).toBe(502);
    expect((await refused.json()).error.code).toBe('POOL_UNREACHABLE');

    // Turning memory off names no model, so it needs no pool to decide, and it is
    // the one change a person can still make while the pool is down.
    const off = await send(app, '/api/memory', put(bearer(key), { enabled: false, chosen: null }));

    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ enabled: false, chosen: null, recommended: null });
  });

  test('suggests the model the deployment named, when it named one', async () => {
    const pool = await startFakePool({ catalog: CATALOG });
    // The pool puts `first-model` first; the deployment says otherwise, and the
    // deployment is the party that knows what its own models cost.
    const { app, auth } = await boot(
      {},
      { url: pool.url, key: 'pool-key' },
      { reflectionModel: 'second-model' },
    );
    const ada = await user(auth);
    const key = (await issue(auth, ada.id, 'workstation')).key;

    expect(await (await send(app, '/api/memory', { headers: bearer(key) })).json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: 'second-model',
    });

    await pool.stop();
  });

  test('falls back to the pool’s own first pick when the named model has gone', async () => {
    const pool = await startFakePool({ catalog: CATALOG });
    const { app, auth } = await boot(
      {},
      { url: pool.url, key: 'pool-key' },
      { reflectionModel: 'retired-model' },
    );
    const ada = await user(auth);
    const key = (await issue(auth, ada.id, 'workstation')).key;

    // A suggestion that cannot be taken is not a suggestion: the pool's own order is
    // the answer rather than a name that means nothing here.
    expect(await (await send(app, '/api/memory', { headers: bearer(key) })).json()).toEqual({
      enabled: true,
      chosen: null,
      recommended: 'first-model',
    });

    await pool.stop();
  });
});
