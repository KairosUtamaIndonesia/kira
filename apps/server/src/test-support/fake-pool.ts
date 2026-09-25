import { createServer } from 'node:http';

/**
 * A stand-in for the credential pool's catalog.
 *
 * Foundry asks the pool for the models it can serve, and asks with
 * `client_version=pi`, which switches CLIProxyAPI's answer from OpenAI's list to
 * the Codex client catalog: a `models` array rather than `data`, `slug` rather
 * than `id`, and a pile of client scaffolding — `base_instructions`,
 * `model_messages`, `available_in_plans` — that belongs to a Codex client rather
 * than to Foundry (docs/internal/research/cliproxyapi-interface.md, measured
 * against the running pool).
 *
 * That catalog is the pool's own synthesis, so `fake-upstream` deliberately does
 * not serve it. That double stands in for a *provider* behind the pool, which is
 * a different thing that happens to share the `/v1/models` path. Only the catalog
 * route is modelled here in any detail: the pool's chat path arrives as OpenAI's
 * shape unchanged, which is why most chat tests can point Foundry straight at
 * `fake-upstream`. A completion is answered here too, minimally, so a test that
 * needs both a catalog and a chat — the pre-flight measuring a request against
 * the output limit its model states — can drive one pool. The proxy's cooldowns
 * and caller-key refusals still belong to a fuller double whenever a test needs
 * them.
 */

export interface FakePoolOptions {
  /**
   * What the pool lists, entry for entry, in the pool's own field names.
   *
   * Defaults to one model shaped like the development chain's, which is what
   * makes the default case interesting: it carries the client scaffolding the
   * catalog is padded with, and — like any model CLIProxyAPI's registry does not
   * know — no `max_tokens` at all.
   */
  catalog?: Record<string, unknown>[];
  /**
   * Something other than a catalog, for the ways asking can fail.
   *
   * A string body is written as it is, so a test can answer junk; anything else
   * is encoded as JSON.
   */
  answers?: { status: number; body?: unknown };
  /** A fixed port, for a dev chain that has to be told where to look. */
  port?: number;
}

/** One request as the pool saw it. */
export interface PoolRequest {
  method: string;
  path: string;
  search: string;
  authorization: string | null;
}

export interface FakePool {
  /** Hand this to Foundry as `config.pool.url`. */
  url: string;
  /** Every request that arrived, in order. */
  requests: PoolRequest[];
  stop(): Promise<void>;
}

/**
 * A model as the pool describes one, with the scaffolding left in.
 *
 * `max_tokens` is absent on purpose: the pool fills it from its own registry, so
 * a model the registry does not know has none.
 */
const DEV_CATALOG: Record<string, unknown>[] = [
  {
    slug: 'fake-model',
    display_name: 'Fake Model',
    description: 'fake-model',
    context_window: 128000,
    max_context_window: 128000,
    input_modalities: ['text', 'image'],
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium', description: 'Balances speed and reasoning depth' },
      { effort: 'high', description: 'Greater reasoning depth' },
    ],
    visibility: 'list',
    supported_in_api: true,
    base_instructions: 'You are Codex, a coding agent.',
    model_messages: { instructions_template: 'You are Codex, a coding agent.' },
    available_in_plans: ['free', 'plus', 'pro'],
  },
];

export async function startFakePool(options: FakePoolOptions = {}): Promise<FakePool> {
  const catalog = options.catalog ?? DEV_CATALOG;
  const requests: PoolRequest[] = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');
    request.resume();

    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      search: url.search,
      authorization: request.headers.authorization ?? null,
    });

    if (url.pathname.endsWith('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'chatcmpl-fake-pool',
          object: 'chat.completion',
          created: 0,
          model: 'fake-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'answered by the pool' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
      return;
    }

    if (!url.pathname.endsWith('/models')) {
      response.writeHead(404).end();
      return;
    }

    if (options.answers) {
      const { status, body } = options.answers;
      const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
      response.writeHead(status, { 'content-type': 'application/json' }).end(text);
      return;
    }

    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ models: catalog }));
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fake pool has no port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
