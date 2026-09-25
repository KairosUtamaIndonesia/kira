import { createServer } from 'node:http';

/**
 * How this upstream reports token counts. The shapes differ in the wild and
 * Kira has to read all of them, so a test can ask for either.
 *
 * `final-chunk` is OpenAI's: a usage-only chunk after the content, carrying
 * `choices: []`. `inline` folds the same object into the last content chunk,
 * the way some providers do. `silent` is a provider that never mentions usage at
 * all, which leaves Kira counting the reply for itself.
 */
export type UsageMode = 'final-chunk' | 'inline' | 'silent';

/** One request as it arrived, which is how a probe sees what a proxy forwarded. */
export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

export interface FakeUpstreamOptions {
  /** Model ids to list, the way a provider advertises them. */
  models?: string[];
  /** Where usage rides. Defaults to `final-chunk`. */
  usage?: UsageMode;
  /** Cache-read tokens to report, so a probe can watch them survive a proxy. */
  cachedTokens?: number;
  /**
   * What the reply says, for a test that needs to know how long it is. Defaults
   * to echoing the request back.
   */
  content?: string;
  /**
   * A refusal instead of a completion, status and headers and all.
   *
   * Only what a test needs to see cross a proxy — the status, the body, and a
   * header the caller is meant to act on. Modelling the *shapes* of these is the
   * separate fake of the proxy's job, not this one's
   * (docs/internal/research/cliproxyapi-interface.md).
   */
  answers?: { status: number; body?: unknown; headers?: Record<string, string> };
  /**
   * How many chunks of a streamed reply to send before it stops, for the replies
   * that stop before their numbers arrive.
   *
   * The response ends there with no terminator. That is deliberate: a reply cut
   * off by a dropped connection leaves the reader able to do nothing but notice
   * the missing marker, which is the case worth testing — tearing the socket down
   * only makes the failure depend on how the client saw the close.
   */
  stopsAfter?: number;
  /** A fixed port, for a dev chain that has to be told where to look. */
  port?: number;
}

export interface FakeUpstream {
  /** Hand this to CLIProxyAPI's `openai-compatibility` `base-url`. */
  url: string;
  /** Every request that arrived, in order. */
  requests: RecordedRequest[];
  /** Forget what arrived, so the next probe starts from a known state. */
  clear(): void;
  stop(): Promise<void>;
}

/**
 * A stand-in for whatever provider sits behind CLIProxyAPI, so the chain can be
 * exercised without a subscription.
 *
 * It answers the two calls Kira's traffic makes — the model list and a chat
 * completion — and it echoes what it was asked for in the reply text, because
 * the interesting question about a proxy is never "did it answer" but "what did
 * it forward". `requests` keeps the bodies verbatim, so a probe can read the
 * fields rather than parse a sentence.
 *
 * It is deliberately not a CLIProxyAPI stand-in: error envelopes, cooldowns and
 * the caller-key handshake are the proxy's business, and those belong in a fake
 * of the proxy (see the note in docs/internal/research/cliproxyapi-interface.md).
 */
export async function startFakeUpstream(options: FakeUpstreamOptions = {}): Promise<FakeUpstream> {
  const models = options.models ?? ['fake-model'];
  const usageMode = options.usage ?? 'final-chunk';
  const cachedTokens = options.cachedTokens ?? 0;
  const requests: RecordedRequest[] = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');

    // The probe surface, so a standalone dev chain can be inspected from any
    // shell without reading the terminal it was started in.
    if (url.pathname === '/_requests') {
      request.resume();
      if (request.method === 'DELETE') {
        requests.splice(0);
        response.writeHead(200, { 'content-type': 'application/json' }).end('[]');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(requests));
      return;
    }

    const body = await readJson(request);
    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      authorization: request.headers.authorization ?? null,
      body,
    });

    if (url.pathname.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          object: 'list',
          data: models.map((id) => ({
            id,
            object: 'model',
            created: 0,
            owned_by: 'fake-upstream',
          })),
        }),
      );
      return;
    }

    if (url.pathname.endsWith('/chat/completions')) {
      if (options.answers) {
        response.writeHead(options.answers.status, {
          'content-type': 'application/json',
          ...options.answers.headers,
        });
        const said = options.answers.body ?? {};
        response.end(typeof said === 'string' ? said : JSON.stringify(said));
        return;
      }

      const completion = answer(body, usageMode, cachedTokens, options.content);
      if (body.stream === true) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });

        const sent = completion.slice(0, options.stopsAfter ?? completion.length);
        for (const chunk of sent) {
          response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (options.stopsAfter === undefined) response.end('data: [DONE]\n\n');
        else response.end();
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: options.content ?? seen(body) },
              finish_reason: 'stop',
            },
          ],
          usage: usage(cachedTokens),
        }),
      );
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fake upstream has no port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    clear: () => requests.splice(0),
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** What the caller asked for, said back, so a forwarded field is visible in the reply. */
function seen(body: Record<string, unknown>): string {
  const ceiling = body.max_tokens ?? body.max_completion_tokens ?? 'none';
  return [
    `model=${String(body.model)}`,
    `max_tokens=${String(ceiling)}`,
    `reasoning_effort=${String(body.reasoning_effort ?? 'none')}`,
    `service_tier=${String(body.service_tier ?? 'none')}`,
  ].join(' ');
}

function usage(cachedTokens: number) {
  return {
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
    prompt_tokens_details: { cached_tokens: cachedTokens },
    completion_tokens_details: { reasoning_tokens: 0 },
  };
}

/** The chunks a streamed answer sends, in order, ending with the content and usage. */
function answer(
  body: Record<string, unknown>,
  mode: UsageMode,
  cachedTokens: number,
  asked: string | undefined,
) {
  const base = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: body.model,
  };
  const content = replyText(body, asked);
  const opening = {
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  const said = {
    ...base,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  const stopped = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };

  if (mode === 'inline') {
    return [opening, { ...said, usage: usage(cachedTokens) }, stopped];
  }

  if (mode === 'silent') {
    return [opening, said, stopped];
  }

  return [opening, said, stopped, { ...base, choices: [], usage: usage(cachedTokens) }];
}

/** The reply's text: what the test asked for, or the request echoed back. */
function replyText(body: Record<string, unknown>, asked: string | undefined): string {
  return asked ?? seen(body);
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}

// Standalone, so a dev chain has something for CLIProxyAPI to route to. The
// cache count is settable because whether it survives the proxy is one of the
// things the dev chain exists to show.
if (import.meta.main) {
  const fake = await startFakeUpstream({
    port: Number(process.env.FAKE_UPSTREAM_PORT ?? 8318),
    cachedTokens: Number(process.env.FAKE_UPSTREAM_CACHED_TOKENS ?? 0),
  });
  console.log(`fake upstream on ${fake.url} — requests at ${fake.url}/_requests`);
}
