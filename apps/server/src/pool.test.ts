import { afterAll, describe, expect, test } from 'bun:test';
import { setAllowance } from './allowance';
import { startFakePool } from './test-support/fake-pool';
import { startFakeUpstream, type UsageMode } from './test-support/fake-upstream';
import {
  bearer,
  boot,
  closeDatabases,
  issue,
  send,
  spent,
  user,
  waitFor,
} from './test-support/server';
import { usageFor } from './usage';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

/**
 * A chat completion as pi sends one.
 *
 * pi states a ceiling on every request, filled from the model's own limit, which
 * is why a request without one is a client that is not pi — and why the
 * pre-flight has to go and look a limit up when it sees one.
 */
function chat(key: string, body: Record<string, unknown> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearer(key) },
    body: JSON.stringify({
      model: 'fake-model',
      stream: true,
      max_tokens: 16384,
      messages: [{ role: 'user', content: 'Hello' }],
      ...body,
    }),
  };
}

describe('a chat through Foundry', () => {
  test('a chat with a Foundry key reaches the pool and streams back', async () => {
    const pool = await startFakeUpstream();
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // What reached the pool: Foundry's own key, never the caller's, and the
    // body the caller sent.
    expect(pool.requests).toHaveLength(1);
    expect(pool.requests[0]?.authorization).toBe('Bearer pool-key');
    expect(pool.requests[0]?.body).toMatchObject({ model: 'fake-model', stream: true });

    const streamed = await response.text();
    expect(streamed).toContain('model=fake-model');
    expect(streamed).toContain('data: [DONE]');

    await pool.stop();
  });

  const refusals: { name: string; headers: Record<string, string>; expected: string }[] = [
    { name: 'no Authorization header', headers: {}, expected: 'KEY_NOT_FOUND' },
    {
      name: 'a well-formed key that was never issued',
      headers: { authorization: 'Bearer 0123456789abcdef' },
      expected: 'INVALID_API_KEY',
    },
  ];

  test.each(refusals)('refuses $name without asking the pool', async ({ headers, expected }) => {
    const pool = await startFakeUpstream();
    const { app } = await boot({}, { url: pool.url, key: 'pool-key' });

    const response = await send(app, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'fake-model', messages: [] }),
    });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(expected);

    // The point of the check: a chat Foundry will not answer is one the pool
    // never sees, so nothing was spent on it.
    expect(pool.requests).toHaveLength(0);

    await pool.stop();
  });

  test('a pool that is down is a failure the caller can report', async () => {
    // Port 9 is discard: nothing listens, so the connection is refused rather
    // than answered, which is what a stopped pool looks like from here.
    const { app, auth } = await boot({}, { url: 'http://127.0.0.1:9', key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('POOL_UNREACHABLE');
  });
});

describe('what a chat used', () => {
  /**
   * Where a provider puts its counts.
   *
   * They ride in different places in the wild — OpenAI appends a chunk of their
   * own after the content, and some providers fold the same object into the last
   * chunk of it — so a reader has to find them wherever they are rather than at
   * the position it assumed.
   */
  const shapes: { name: string; usage: UsageMode }[] = [
    { name: 'counts that arrive in a chunk of their own', usage: 'final-chunk' },
    { name: 'counts folded into the last chunk of content', usage: 'inline' },
  ];

  test.each(shapes)('a streamed chat is written down with $name', async ({ usage }) => {
    // The cache-read figure is the one that has to survive the trip: it is not
    // a top-level field but a detail under the prompt's own, and a reader that
    // only looked at the top level would quietly count it as zero.
    const pool = await startFakeUpstream({ usage, cachedTokens: 9 });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));
    await response.text();

    // Written down beside the reply rather than in front of it, so a reply that
    // has arrived does not yet mean its row has.
    await waitFor(
      async () => (await usageFor(database, ada.id)).length === 1,
      'the chat to be written down',
      3000,
    );

    const [written] = await usageFor(database, ada.id);

    expect(written).toMatchObject({
      userId: ada.id,
      model: 'fake-model',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 9,
      cacheWriteTokens: 0,
      outcome: 'ok',
    });
    // When it completed, rather than whenever somebody asked. `Date.parse('')`
    // is NaN, so a row with no instant fails this rather than sneaking past.
    expect(Date.now() - Date.parse(written?.at ?? '')).toBeLessThan(60_000);

    await pool.stop();
  });

  test('a provider that never mentions usage is counted from the reply itself', async () => {
    // Four hundred characters of reply, so the expectation is a round number a
    // reader can check by hand rather than the count recomputed here.
    const pool = await startFakeUpstream({ usage: 'silent', content: 'x'.repeat(400) });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));
    await response.text();

    await waitFor(
      async () => (await usageFor(database, ada.id)).length === 1,
      'the chat to be written down',
      3000,
    );

    const [written] = await usageFor(database, ada.id);

    // Four characters to a token, which is the rule pi itself estimates with, so
    // the server's figure and the client's agree about the same text.
    expect(written).toMatchObject({ model: 'fake-model', outputTokens: 100, outcome: 'ok' });

    await pool.stop();
  });

  test('a provider that never mentions usage is charged for the question as well', async () => {
    const pool = await startFakeUpstream({ usage: 'silent', content: 'x'.repeat(400) });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(
      app,
      '/v1/chat/completions',
      chat(key.key, {
        messages: [
          { role: 'user', content: 'question'.repeat(100) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look at this'.repeat(50) },
              // Forty thousand characters of payload, so a count that read an
              // image as its base64 would be out by an order of magnitude rather
              // than by a rounding error.
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${'A'.repeat(40000)}` },
              },
            ],
          },
        ],
      }),
    );
    await response.text();

    await waitFor(
      async () => (await usageFor(database, ada.id)).length === 1,
      'the chat to be written down',
      3000,
    );

    const [written] = await usageFor(database, ada.id);

    // 800 characters of question plus 600 of text part plus 4800 for the picture,
    // at four characters to a token. The picture's own 40000 characters are not in
    // that number, which is the point: an image is worth a picture, and counting
    // the base64 that carries it would report a prompt costing more than every
    // token the provider has.
    expect(written).toMatchObject({ inputTokens: 1550 });

    await pool.stop();
  });

  test('a reply that stops part-way is written down, and says so', async () => {
    // Two chunks of a four-chunk reply: the caller gets the content and then the
    // reply stops, with no end marker to say it was finished.
    const pool = await startFakeUpstream({
      usage: 'silent',
      content: 'x'.repeat(400),
      stopsAfter: 2,
    });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));

    // The caller's copy stops where Foundry's did. A stream that is cut off
    // leaves no trace of its own at the transport level — the connection simply
    // stops, and that is indistinguishable from a reply that ended — so what
    // says it broke is the pool's end marker being absent, which is the same
    // thing pi reads.
    const arrived = await response.text();
    expect(arrived).toContain('x'.repeat(400));
    expect(arrived).not.toContain('[DONE]');

    await waitFor(
      async () => (await usageFor(database, ada.id)).length === 1,
      'the chat to be written down',
      3000,
    );

    const [written] = await usageFor(database, ada.id);

    // Counted from the reply that did arrive, and marked rather than passed off
    // as a reply that finished: an allowance that only counted the requests that
    // went well could be walked around by making them go badly.
    expect(written).toMatchObject({ model: 'fake-model', outputTokens: 100, outcome: 'failed' });

    await pool.stop();
  });

  test('a chat the pool refuses crosses back, and is written down as a refusal', async () => {
    // What the pool answers when every credential for a model is cooling down: a
    // 429 with the wait attached (docs/internal/research/cliproxyapi-interface.md).
    const pool = await startFakeUpstream({
      answers: {
        status: 429,
        body: {
          error: {
            code: 'model_cooldown',
            message: 'All credentials for model fake-model are cooling down',
          },
        },
        headers: { 'retry-after': '30' },
      },
    });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));

    // The refusal is the pool's, handed over as the pool wrote it.
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe('model_cooldown');
    // How long to wait is part of the refusal rather than the pool's private
    // business, so a client can act on it instead of asking again at once.
    expect(response.headers.get('retry-after')).toBe('30');

    // Nothing was spent on a request nobody answered, and it is still a fact
    // worth keeping: the pool's own record of a refusal lives in memory for a
    // minute and nowhere else, so this row is the only durable one there is. One
    // row and no more is also the claim that a refusal cannot leave a *spend*
    // behind it — the counting path is gated on the pool having answered.
    expect(await usageFor(database, ada.id)).toMatchObject([
      {
        model: 'fake-model',
        inputTokens: 0,
        outputTokens: 0,
        outcome: 'refused',
        reason: 'model_cooldown',
      },
    ]);

    await pool.stop();
  });
});

describe('the models Foundry offers', () => {
  test('are the ones the pool can serve, as Foundry describes them', async () => {
    const pool = await startFakePool();
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/api/models', { headers: bearer(key.key) });

    expect(response.status).toBe(200);

    // Exactly this, and nothing else: the pool pads every entry with a Codex
    // client's own scaffolding, and a model the pool's registry does not know
    // carries no output limit to report.
    expect(await response.json()).toEqual({
      models: [
        {
          id: 'fake-model',
          name: 'Fake Model',
          contextWindow: 128000,
          input: ['text', 'image'],
          reasoning: true,
        },
      ],
    });

    // Asked for the catalog at all — the query is what makes the pool answer in
    // the shape this reads — and with Foundry's own key, never the caller's.
    expect(pool.requests).toHaveLength(1);
    expect(pool.requests[0]).toMatchObject({
      path: '/v1/models',
      search: '?client_version=pi',
      authorization: 'Bearer pool-key',
    });

    await pool.stop();
  });

  /**
   * Every way the catalog can fail to arrive.
   *
   * `reached` is whether the pool was asked at all, which for a refused caller
   * is the point: a request Foundry will not answer is one nothing was spent on.
   */
  const refusals: {
    name: string;
    presents: 'issued' | 'bogus' | 'none';
    answers?: { status: number; body?: unknown };
    deadPool?: boolean;
    reached: boolean;
    expected: number;
    code: string;
  }[] = [
    {
      name: 'the caller presents no key',
      presents: 'none',
      reached: false,
      expected: 401,
      code: 'KEY_NOT_FOUND',
    },
    {
      name: 'the caller presents a key that was never issued',
      presents: 'bogus',
      reached: false,
      expected: 401,
      code: 'INVALID_API_KEY',
    },
    {
      name: 'the pool is not there to ask',
      presents: 'issued',
      deadPool: true,
      reached: false,
      expected: 502,
      code: 'POOL_UNREACHABLE',
    },
    {
      name: 'the pool refuses the key Foundry presents',
      presents: 'issued',
      answers: { status: 401, body: '{"error":"Invalid API key"}' },
      reached: true,
      expected: 502,
      code: 'POOL_REFUSED',
    },
    {
      name: 'the pool answers the OpenAI list instead of the catalog',
      presents: 'issued',
      answers: { status: 200, body: { object: 'list', data: [{ id: 'fake-model' }] } },
      reached: true,
      expected: 502,
      code: 'POOL_REFUSED',
    },
    {
      name: 'the pool answers something that is not JSON',
      presents: 'issued',
      answers: { status: 200, body: '<html>the gateway answered, not the pool</html>' },
      reached: true,
      expected: 502,
      code: 'POOL_REFUSED',
    },
    {
      name: 'the catalog holds an entry with no id',
      presents: 'issued',
      answers: { status: 200, body: { models: [{ display_name: 'Nameless' }] } },
      reached: true,
      expected: 502,
      code: 'POOL_REFUSED',
    },
  ];

  test.each(refusals)(
    'is refused when $name',
    async ({ presents, answers, deadPool, reached, expected, code }) => {
      const pool = await startFakePool(answers ? { answers } : {});
      const { app, auth } = await boot(
        {},
        { url: deadPool ? 'http://127.0.0.1:9' : pool.url, key: 'pool-key' },
      );
      const ada = await user(auth);
      const key = await issue(auth, ada.id, 'workstation');

      const headers =
        presents === 'issued'
          ? bearer(key.key)
          : presents === 'bogus'
            ? { authorization: 'Bearer 0123456789abcdef' }
            : {};

      const response = await send(app, '/api/models', { headers });

      expect(response.status).toBe(expected);
      expect((await response.json()).error.code).toBe(code);
      expect(pool.requests.length > 0).toBe(reached);

      await pool.stop();
    },
  );

  test('a pool with nothing to serve is answered as an empty catalog', async () => {
    const pool = await startFakePool({ catalog: [] });
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/api/models', { headers: bearer(key.key) });

    // An empty catalog is the pool saying there are no models, which is a fact
    // about the pool rather than a failure to reach it — and the only one of the
    // two that may replace what the desktop remembers.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });

    await pool.stop();
  });

  test('a model the pool hides is not offered, even when it sorts first', async () => {
    const pool = await startFakePool({
      catalog: [
        {
          slug: 'codex-auto-review',
          display_name: 'Codex Auto Review',
          visibility: 'hide',
          priority: 43,
        },
        { slug: 'gpt-6-astra', display_name: 'GPT 6.0 Astra', visibility: 'list', priority: 1 },
      ],
    });
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/api/models', { headers: bearer(key.key) });

    // The pool marks a model `hide` when it does not want it offered — its own
    // review-only and image models carry it — and `codex-auto-review` sorts
    // before every `gpt-` id, so a catalog that keeps it hands a desktop that
    // takes the first one a model the pool never meant to offer.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [{ id: 'gpt-6-astra', name: 'GPT 6.0 Astra' }],
    });

    await pool.stop();
  });

  test('come back in the order the pool ranks them', async () => {
    const pool = await startFakePool({
      catalog: [
        { slug: 'gpt-5.5', display_name: 'GPT 5.5', visibility: 'list', priority: 12 },
        { slug: 'gpt-6-astra', display_name: 'GPT 6.0 Astra', visibility: 'list', priority: 1 },
        { slug: 'gpt-5.6-luna', display_name: 'GPT 5.6 Luna', visibility: 'list', priority: 8 },
      ],
    });
    const { app, auth } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/api/models', { headers: bearer(key.key) });

    // Deliberately not the order they arrive in, and not their ids' order
    // either: the pool's `priority` is a ranking it already keeps, and it is the
    // only thing here that says which model a person should be given.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        { id: 'gpt-6-astra', name: 'GPT 6.0 Astra' },
        { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
        { id: 'gpt-5.5', name: 'GPT 5.5' },
      ],
    });

    await pool.stop();
  });
});

describe('what a person is allowed', () => {
  /**
   * The allowance is checked before the pool is contacted, so what these tests
   * look at is mostly what the pool *did not* see — the requests array is the
   * evidence that nothing was spent on a request that was never going to be
   * allowed.
   */
  const requests: {
    name: string;
    allowance: number;
    used: number;
    body: Record<string, unknown>;
    expected: number;
  }[] = [
    {
      name: 'a request that fits is sent',
      allowance: 1000,
      used: 0,
      body: { max_tokens: 50 },
      expected: 200,
    },
    {
      name: 'a request that would pass the allowance is refused',
      allowance: 100,
      used: 90,
      body: { max_tokens: 50 },
      expected: 403,
    },
    {
      name: 'a request whose ceiling alone passes it is refused',
      allowance: 100,
      used: 0,
      body: { max_tokens: 200 },
      expected: 403,
    },
  ];

  test.each(requests)('$name', async ({ allowance, used, body, expected }) => {
    const pool = await startFakeUpstream();
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    await setAllowance(database, ada.id, allowance);
    if (used > 0) await spent(database, ada.id, { inputTokens: used });

    const response = await send(app, '/v1/chat/completions', chat(key.key, body));

    expect(response.status).toBe(expected);
    expect(pool.requests).toHaveLength(expected === 200 ? 1 : 0);

    await pool.stop();
  });

  test('a refusal is written down, with nothing spent', async () => {
    const pool = await startFakeUpstream();
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    await setAllowance(database, ada.id, 100);
    await spent(database, ada.id, { inputTokens: 90 });

    const response = await send(app, '/v1/chat/completions', chat(key.key, { max_tokens: 50 }));

    expect(response.status).toBe(403);
    // OpenAI's envelope, with the type OpenAI uses for a request past a budget:
    // pi parses these shapes, so the fields it looks for have to be there.
    expect((await response.json()).error).toMatchObject({
      code: 'allowance_exceeded',
      type: 'insufficient_quota',
    });

    // The refusal is a fact about the month like any other row, and it is the
    // one an operator reads to see who is being turned away.
    expect(await usageFor(database, ada.id)).toMatchObject([
      { inputTokens: 90, outcome: 'ok' },
      {
        model: 'fake-model',
        inputTokens: 0,
        outputTokens: 0,
        outcome: 'refused',
        reason: 'allowance_exceeded',
      },
    ]);

    await pool.stop();
  });

  test('a refusal that is not JSON still has a reason', async () => {
    // A gateway in front of the pool answering in HTML is the usual way a
    // refusal arrives without a code in it, and the status is then all there is.
    const pool = await startFakeUpstream({
      answers: { status: 502, body: '<html>bad gateway</html>' },
    });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    const response = await send(app, '/v1/chat/completions', chat(key.key));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('<html>bad gateway</html>');
    expect(await usageFor(database, ada.id)).toMatchObject([
      { outcome: 'refused', reason: 'http_502', inputTokens: 0 },
    ]);

    await pool.stop();
  });

  test('an allowance of their own beats the default', async () => {
    const pool = await startFakeUpstream();
    const { app, auth, database, config } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    // Spent past what everybody gets, with no allowance of their own: refused.
    const overTheDefault = config.allowance.defaultTokens + 1000;
    await spent(database, ada.id, { inputTokens: overTheDefault });

    expect((await send(app, '/v1/chat/completions', chat(key.key, { max_tokens: 1 }))).status).toBe(
      403,
    );

    // The same person, with a number of their own that covers it: sent. The
    // default is a floor for everybody, not a ceiling on anybody.
    await setAllowance(database, ada.id, overTheDefault + 1000);

    expect((await send(app, '/v1/chat/completions', chat(key.key, { max_tokens: 1 }))).status).toBe(
      200,
    );

    await pool.stop();
  });

  test('a request with no ceiling of its own is measured against its model', async () => {
    // The pool states an output limit of 50, which fits inside an allowance of
    // 100 where pi's own default of 16384 would not: the request being sent is
    // what proves the model's own limit was the one consulted.
    const pool = await startFakePool({
      catalog: [
        {
          slug: 'fake-model',
          display_name: 'Fake Model',
          context_window: 128000,
          max_tokens: 50,
        },
      ],
    });
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    await setAllowance(database, ada.id, 100);

    const response = await send(app, '/v1/chat/completions', {
      ...chat(key.key),
      body: JSON.stringify({
        model: 'fake-model',
        stream: false,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(pool.requests.map((seen) => seen.path)).toEqual(['/v1/models', '/v1/chat/completions']);

    await pool.stop();
  });

  test('a pool that cannot say what a model allows leaves pi’s own ceiling', async () => {
    // The provider fake answers the plain model list rather than the pool's
    // catalog, so Foundry cannot learn a limit from it — and a request with no
    // ceiling must still be measured against something rather than waved through.
    const pool = await startFakeUpstream();
    const { app, auth, database } = await boot({}, { url: pool.url, key: 'pool-key' });
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'workstation');

    // Two tokens of question, so the boundary is pi's 16384 and nothing else.
    // No ceiling at all in the request, which is what sends Foundry looking.
    await setAllowance(database, ada.id, 16_385);
    expect(
      (await send(app, '/v1/chat/completions', chat(key.key, { max_tokens: undefined }))).status,
    ).toBe(403);

    await setAllowance(database, ada.id, 16_386);
    expect(
      (await send(app, '/v1/chat/completions', chat(key.key, { max_tokens: undefined }))).status,
    ).toBe(200);

    await pool.stop();
  });
});
