import { Elysia } from 'elysia';
import { fits, standingFor } from './allowance';
import type { Auth } from './auth';
import type { Config } from './config';
import type { CatalogModel } from './contract';
import type { Database } from './database';
import { keyHolder } from './keys';
import { refusal } from './refusals';
import { OUTCOME, recordUsage, type UsageRecord } from './usage';

/**
 * The OpenAI-shaped seam the desktop sends model traffic through.
 *
 * It speaks OpenAI's Chat Completions shape because the desktop's pi client
 * does, and forwards into the pool — CLIProxyAPI — which holds the company's
 * provider logins and presents them upstream
 * (docs/adr/0003-model-credentials.md). Kira holds no provider credential;
 * what it holds is the pool's caller key, and that is the one thing a caller
 * must not be able to reach.
 *
 * The shape here is pi's rather than Kira's, which is two decisions. It
 * stays out of Kira's OpenAPI document, because it is not an API Kira is
 * offering. And a refusal from the pool is passed back as the pool wrote it, so
 * a client reads it the way it reads a provider's own errors.
 *
 * What a request used is counted on the way past and written to the ledger —
 * the one thing about a request that nothing downstream of Kira will ever
 * tell it (docs/adr/0005-allowances.md).
 *
 * The catalog Kira offers lives here too, because it comes from the same
 * place: which models exist is a question only the pool can answer, and it is
 * Kira that translates the answer. That one is Kira's own shape rather
 * than pi's — see `catalogIn`.
 */
export function createPool({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return new Elysia()
    .post(
      '/v1/chat/completions',
      async ({ request, status }) => {
        const held = await keyHolder(auth, request);
        if ('refusal' in held) {
          return status(401, refusal(held.refusal.code, held.refusal.message));
        }

        // The body goes upstream as it arrived rather than re-encoded: it is
        // pi's request, and a field Kira does not understand is not one it
        // has any business rewriting.
        const body = await request.text();

        // Read once, because the model, the question and the ceiling are all in
        // it. A body this cannot read is one the pool will refuse, and a refused
        // request leaves no row, so an unreadable one is worth nothing here
        // rather than an error.
        const asked = askedIn(body);

        // What the person has already spent, and what this request would add to
        // it. Before the pool is contacted, because the point of the check is
        // that a request past the allowance spends nothing at all
        // (docs/adr/0005-allowances.md).
        const standing = await standingFor(database, held.user.id, config.allowance);
        const askedFor = promptIn(asked) + (await ceilingFor(asked, config));

        if (!fits(standing, askedFor)) {
          await recordRefusal(database, {
            userId: held.user.id,
            model: modelIn(asked),
            reason: 'allowance_exceeded',
          });

          return status(
            403,
            refusal(
              'allowance_exceeded',
              `This month's allowance of ${standing.allowance} tokens is spent — ${standing.used} used, and this request would use about ${askedFor} more.`,
              // OpenAI's own word for a request past somebody's budget.
              'insufficient_quota',
            ),
          );
        }

        let upstream: Response;
        try {
          upstream = await fetch(`${config.pool.url}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.pool.key}`,
            },
            body,
          });
        } catch (cause) {
          // The pool being down is the failure Kira can actually expect, and
          // it has to arrive as something a client can report rather than as a
          // bare 500.
          return status(
            502,
            refusal('POOL_UNREACHABLE', `The pool did not answer: ${String(cause)}`),
          );
        }

        // Only the status and the shape of the body cross back: the pool's own
        // headers belong to the pool, and a client is reading a provider's reply.
        // How long to wait is the exception, because it is addressed to the caller
        // — the pool saying "later" is only useful to somebody who can wait.
        const contentType = upstream.headers.get('content-type') ?? 'application/json';
        const headers: Record<string, string> = { 'content-type': contentType };
        const wait = upstream.headers.get('retry-after');
        if (wait !== null) headers['retry-after'] = wait;

        // A refusal: the pool would not take the request, so nothing was spent —
        // and that is exactly the fact worth keeping, because the proxy's own
        // record of a refusal lives in memory for a minute and nowhere else. The
        // body is read to learn why and then handed on exactly as it arrived.
        if (!upstream.ok) {
          const said = await upstream.text();

          await recordRefusal(database, {
            userId: held.user.id,
            model: modelIn(asked),
            reason: refusalReasonIn(said, upstream.status),
          });

          return new Response(said, { status: upstream.status, headers });
        }

        // A reply with nothing in it. Nothing was spent, so nothing is counted,
        // and there is no second copy of anything left running behind the reply.
        if (upstream.body === null) {
          return new Response(null, { status: upstream.status, headers });
        }

        const [toCaller, toCount] = upstream.body.tee();

        // Counted beside the reply rather than in front of it: a caller's last byte
        // should not wait on the ledger, and a caller who hangs up should not cost
        // Kira the record of what was spent on them.
        void tally(toCount, {
          database,
          userId: held.user.id,
          asked,
          streaming: contentType.includes('text/event-stream'),
        }).catch((cause) =>
          console.error('[kira] what a chat used was not written down:', cause),
        );

        return new Response(toCaller, { status: upstream.status, headers });
      },
      { detail: { hide: true } },
    )
    .get(
      '/api/models',
      async ({ request, status }) => {
        const held = await keyHolder(auth, request);
        if ('refusal' in held) {
          return status(401, refusal(held.refusal.code, held.refusal.message));
        }

        // Asked as a pi client asks, because that is the answer carrying the
        // per-model facts. What the pool lists is the union of what its loaded
        // credentials can serve right now, not a list of what the company
        // subscribes to (docs/internal/research/cliproxyapi-interface.md).
        const catalog = await poolCatalog(config);

        // Nothing was answered, which is not the same fact as an answer of none:
        // relaying this as an empty catalog would erase the models a desktop has
        // already remembered.
        const answer = poolAnswer(catalog);
        if (answer.kind === 'refused') {
          return status(502, refusal(answer.code, answer.message));
        }

        return { models: answer.models };
      },
      { detail: { hide: true } },
    );
}

/** The part of a ledger row that a completion stream can say for itself. */
type Counted = Omit<UsageRecord, 'userId' | 'model' | 'outcome' | 'at'>;

/**
 * Why the pool turned a request away, in the words the caller was answered with.
 *
 * The pool answers in OpenAI's error shape, so the code inside it is the honest
 * reason; a refusal without one — a gateway in front, a crash — leaves the status
 * as the only thing that was said.
 */
function refusalReasonIn(body: string, status: number): string {
  try {
    const said = JSON.parse(body) as { error?: { code?: unknown } };
    const code = said.error?.code;
    if (typeof code === 'string' && code !== '') return code;
  } catch {
    // A refusal that is not JSON is still a refusal.
  }

  return `http_${status}`;
}

/**
 * pi's own ceiling for a request that states none.
 *
 * Kept here rather than invented, so Kira's estimate of a request agrees with
 * the client that would have made it.
 */
const DEFAULT_OUTPUT_TOKENS = 16384;

/**
 * Write down a request Kira turned away.
 *
 * A refusal costs nothing and is still a fact worth keeping: it is how an
 * operator sees who is being refused and why, and for a refusal by the pool it is
 * the only durable record there is — the proxy keeps its own usage in memory for
 * a minute and nothing on disk (docs/adr/0005-allowances.md).
 */
async function recordRefusal(
  database: Database,
  { userId, model, reason }: { userId: string; model: string; reason: string },
): Promise<void> {
  await recordUsage(database, {
    userId,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outcome: OUTCOME.refused,
    reason,
    at: new Date().toISOString(),
  });
}

/**
 * The ceiling a request is measured against: what it asked for, or what its model
 * allows.
 *
 * A request stating `max_tokens` is measured against it, and nothing else is
 * consulted. One that states none is measured against the model's own output
 * limit, which only the pool knows; a pool that cannot say leaves pi's default,
 * because a conservative estimate is better than a request waved through.
 */
async function ceilingFor(asked: unknown, config: Config): Promise<number> {
  const stated = size((asked as { max_tokens?: unknown } | null)?.max_tokens);
  if (stated !== undefined) return stated;

  const catalog = await poolCatalog(config);
  const model =
    catalog.kind === 'ok' ? catalog.models.find((entry) => entry.id === modelIn(asked)) : undefined;

  return model?.maxOutput ?? DEFAULT_OUTPUT_TOKENS;
}

/** What the pool said when it was asked which models it can serve. */
export type PoolCatalog =
  | { kind: 'ok'; models: CatalogModel[] }
  | { kind: 'unreachable'; cause: unknown }
  | { kind: 'refused'; status: number };

/**
 * Ask the pool which models it can serve, and read the answer.
 *
 * The three answers are three different facts: what the pool can serve, that the
 * pool could not be asked at all, and that it answered with something that is not
 * a catalog. Only the first is a list of models.
 */
export async function poolCatalog(config: Config): Promise<PoolCatalog> {
  let upstream: Response;
  try {
    upstream = await fetch(`${config.pool.url}/v1/models?client_version=pi`, {
      headers: { authorization: `Bearer ${config.pool.key}` },
    });
  } catch (cause) {
    return { kind: 'unreachable', cause };
  }

  // Read whatever the status, so the connection is finished with either way; only
  // the status decides whether the body is worth believing.
  const said = await upstream.json().catch(() => null);
  const models = upstream.ok ? catalogIn(said) : null;

  return models === null ? { kind: 'refused', status: upstream.status } : { kind: 'ok', models };
}

/**
 * Either the catalog the pool answered with, or the refusal that stands in for
 * having none.
 *
 * Two facts and two codes. A pool that could not be reached at all is a transport
 * failure; one that answered with something that is not a catalog is a gateway or
 * a misconfiguration, and the only way that usually happens is something between
 * Kira and the pool answering in HTML.
 *
 * Either way it is Kira's problem rather than the caller's — a pool that turns
 * away the key Kira presents is a server misconfigured, and passing that 401
 * back would tell the caller their own key was wrong — so it is refused with
 * Kira's own code and a 502. Written once because two routes ask the pool about
 * its catalog and neither should invent its own words for what went wrong.
 */
export type PoolAnswer =
  | { kind: 'ok'; models: CatalogModel[] }
  | { kind: 'refused'; code: string; message: string };

/** What a pool that was asked for its catalog is worth telling a caller. */
export function poolAnswer(catalog: PoolCatalog): PoolAnswer {
  if (catalog.kind === 'ok') return { kind: 'ok', models: catalog.models };

  if (catalog.kind === 'unreachable') {
    return {
      kind: 'refused',
      code: 'POOL_UNREACHABLE',
      message: `The pool did not answer: ${String(catalog.cause)}`,
    };
  }

  return {
    kind: 'refused',
    code: 'POOL_REFUSED',
    message: `The pool did not answer with a catalog (HTTP ${catalog.status}).`,
  };
}

/**
 * What the pool ends a stream with, and the only sign that it ended rather than
 * stopped.
 */
const END_OF_STREAM = 'data: [DONE]';

/**
 * Watches a completion stream go past and writes down what it used.
 *
 * The bytes are read for what the provider said and left exactly as they are, so
 * what this sees is what the caller sees. What the *last* chunk to mention usage
 * said is what counts rather than the first: a stream may carry an all-zero usage
 * object early on, and latching onto that one is a bug CLIProxyAPI's own tracker
 * keeps re-fixing (docs/internal/research/cliproxyapi-interface.md).
 *
 * Either end of the conversation may be the one the provider did not account for.
 * A reply that arrived without a figure is counted from its own characters; a
 * question the provider never priced is counted from the request. Neither is
 * exact and neither has to be: both fill in only where the provider gave nothing,
 * and a request whose provider says nothing is exactly the request an allowance
 * must not treat as free.
 *
 * A reply that stopped before it said it was finished is written down as failed.
 * The connection going quiet after a whole frame is not distinguishable from a
 * reply that ended, so the end marker is what this goes by, and a stream that
 * never reaches it is one whose tokens the caller did not get to read.
 */
async function tally(
  chunks: ReadableStream<Uint8Array>,
  {
    database,
    userId,
    asked,
    streaming,
  }: { database: Database; userId: string; asked: unknown; streaming: boolean },
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  let said: Counted | null = null;
  let produced = 0;
  let finished = false;
  let broke = false;

  try {
    for await (const chunk of chunks) {
      pending += decoder.decode(chunk, { stream: true });

      // The last piece may be half a line: the network is free to cut anywhere,
      // and a chunk is not a line.
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';

      for (const line of lines) {
        const text = line.trim();
        if (text === END_OF_STREAM) {
          finished = true;
          continue;
        }

        const arrived = chunkIn(text);
        if (arrived === null) continue;

        said = usageOf(arrived) ?? said;
        produced += producedIn(arrived);
      }
    }
  } catch {
    // Reading a reply can fail outright as well as stop early, and either way
    // what arrived before it did was still spent.
    broke = true;
  }

  // The provider's numbers, and where it gave none, what each end of the
  // conversation was worth in characters. A zero counts as none here on purpose:
  // a figure of zero is what a provider sends when it has not worked the number
  // out yet.
  const counted: Counted = {
    inputTokens: said?.inputTokens || promptIn(asked),
    outputTokens: said?.outputTokens || estimated(produced),
    cacheReadTokens: said?.cacheReadTokens ?? 0,
    cacheWriteTokens: said?.cacheWriteTokens ?? 0,
  };

  await recordUsage(database, {
    ...counted,
    userId,
    model: modelIn(asked),
    outcome: broke || (streaming && !finished) ? OUTCOME.failed : OUTCOME.ok,
    at: new Date().toISOString(),
  });
}

/**
 * The chunk one line of a completion stream carried, or null if it carried none.
 *
 * Framing only. A line that is not a data line, the terminator, and anything that
 * does not parse as JSON are all simply not chunks: a stream is not always the
 * JSON this is looking for — a provider that fails part-way answers in prose — and
 * none of that is this reader's to complain about. Whatever a chunk means is pi's
 * business, since pi is what asked for it.
 */
function chunkIn(text: string): unknown {
  if (!text.startsWith('data:')) return null;

  const payload = text.slice('data:'.length).trim();
  if (payload === '' || payload === '[DONE]') return null;

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/** What a chunk said the request used, or null if it said nothing about it. */
function usageOf(chunk: unknown): Counted | null {
  if (typeof chunk !== 'object' || chunk === null) return null;

  const said = (chunk as { usage?: unknown }).usage;
  if (typeof said !== 'object' || said === null) return null;

  const usage = said as Record<string, unknown>;
  const prompt = usage.prompt_tokens_details as Record<string, unknown> | undefined;

  return {
    inputTokens: counted(usage.prompt_tokens),
    outputTokens: counted(usage.completion_tokens),
    // What a prompt cache was read from is a detail under the prompt's own counts
    // rather than a top-level one, and reading zero here would charge the caller
    // for tokens the provider did not bill.
    cacheReadTokens: counted(prompt?.cached_tokens),
    // Nothing in the pool's surface reports what a provider wrote to its cache,
    // so this stays zero until something does.
    cacheWriteTokens: 0,
  };
}

/**
 * The characters of reply one chunk carried.
 *
 * Only what a client would read as the answer. Whatever else a provider puts in a
 * delta — its own reasoning, a tool call being assembled — is not counted here, so
 * a provider that reports nothing leaves those tokens unaccounted for too.
 */
function producedIn(chunk: unknown): number {
  if (typeof chunk !== 'object' || chunk === null) return 0;

  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return 0;

  let characters = 0;
  for (const choice of choices) {
    const content = (choice as { delta?: { content?: unknown } } | null)?.delta?.content;
    if (typeof content === 'string') characters += content.length;
  }

  return characters;
}

/**
 * Tokens, from characters.
 *
 * Four characters to a token, which is the rule pi estimates with, so the server's
 * figure and the client's agree about the same text. It is a guess and is only
 * ever used as one: a number the provider gave is what the row keeps, and this
 * fills in only where the provider gave none.
 */
function estimated(characters: number): number {
  return Math.ceil(characters / 4);
}

/**
 * What one picture counts as, in characters.
 *
 * pi's own estimate for an image, kept so the two agree, and emphatically not the
 * length of the base64 that carries it: a single screenshot is a few hundred
 * thousand characters, so counting an image as its bytes would report a prompt
 * costing more than every token the provider has.
 */
const IMAGE_CHARACTERS = 4800;

/** A token count as a number, with anything that is not one counted as none. */
function counted(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * A completion request, as far as Kira can read one.
 *
 * Parsed from the bytes rather than taken from anywhere else because the bytes are
 * already here and are what went upstream. Anything unreadable reads as nothing.
 */
function askedIn(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * The model a request asked for, as far as Kira can read it.
 *
 * A body without one is a body the pool will refuse, and a refused request leaves
 * no row to put a model in.
 */
function modelIn(asked: unknown): string {
  const model = (asked as { model?: unknown } | null)?.model;
  return typeof model === 'string' ? model : '';
}

/**
 * What the question was worth, for the case where the provider does not say.
 *
 * The text a request carries, over its messages and their parts. A message's
 * content is either the text itself or a list of parts, and only text parts are
 * read as text — an image part is worth a picture, not the base64 that transports
 * it (see `IMAGE_CHARACTERS`). Everything else a message can carry is left alone,
 * so a tool call's arguments are not counted as something the user typed.
 */
function promptIn(asked: unknown): number {
  const messages = (asked as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return 0;

  let characters = 0;
  for (const message of messages) {
    const content = (message as { content?: unknown } | null)?.content;

    if (typeof content === 'string') {
      characters += content.length;
      continue;
    }

    if (!Array.isArray(content)) continue;

    for (const part of content) {
      const held = part as { type?: unknown; text?: unknown } | null;
      if (held?.type === 'text' && typeof held.text === 'string') characters += held.text.length;
      else if (held?.type === 'image_url') characters += IMAGE_CHARACTERS;
    }
  }

  return estimated(characters);
}

/**
 * The models the pool can serve, as Kira describes them.
 *
 * Only what the pool stated is carried, under Kira's names. A field the pool
 * does not carry is left out rather than guessed: pi's model entry wants more
 * than the pool knows, and a context window or an output limit invented here
 * would read as a fact rather than as the guess it is. The id is the exception,
 * because it is what a model is asked for by — an entry without one means this
 * was not a catalog Kira can read, and half a catalog is a wrong one.
 *
 * A `null` answer is therefore "that was not a catalog", never "there are no
 * models": an empty catalog is an empty array, and the two are different facts
 * about the pool.
 *
 * Two more of the pool's facts are read here rather than copied out. A model the
 * pool marks `hide` is one it does not want offered, so it is left out of what
 * Kira offers; and `priority` is the pool's own ranking, which is what decides
 * the order these come back in — a desktop with no model chosen yet takes the
 * first, and the pool is the one that knows which model should be.
 */
function catalogIn(body: unknown): CatalogModel[] | null {
  const entries = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(entries)) return null;

  const offered: ReadCatalogEntry[] = [];
  for (const entry of entries) {
    const read = catalogModelIn(entry);
    if (read === null) return null;
    if (read.offered) offered.push(read);
  }

  // In the pool's order, so the same pool gives the same answer twice running,
  // and so the model a desktop takes first is the one the pool puts first rather
  // than whichever id happens to sort lowest. Ids break ties.
  offered.sort(
    (left, right) => left.rank - right.rank || left.model.id.localeCompare(right.model.id),
  );

  return offered.map((read) => read.model);
}

/**
 * One entry of the pool's catalog, read.
 *
 * `offered` is what the pool's `visibility` says: a model marked `hide` is one
 * it does not want offered — its own review-only and image models carry it — and
 * anything else, including saying nothing at all, is offered, so a pool that
 * does not use the field keeps offering everything it serves. `rank` is its
 * `priority`, the pool's own ordering, with an unranked model after every ranked
 * one.
 */
interface ReadCatalogEntry {
  model: CatalogModel;
  offered: boolean;
  rank: number;
}

/** One entry of the pool's catalog, as far as Kira can read it. */
function catalogModelIn(entry: unknown): ReadCatalogEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const held = entry as Record<string, unknown>;
  const id = word(held.slug);
  if (id === undefined) return null;

  const offered = word(held.visibility) !== 'hide';
  const rank =
    typeof held.priority === 'number' && Number.isFinite(held.priority)
      ? held.priority
      : Number.POSITIVE_INFINITY;

  const model: CatalogModel = { id };

  const name = word(held.display_name);
  if (name !== undefined) model.name = name;

  const contextWindow = size(held.context_window);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;

  // The pool fills its output limit from its own registry, so a model that
  // registry does not know has none to report — which is not a limit of zero.
  const maxOutput = size(held.max_tokens);
  if (maxOutput !== undefined) model.maxOutput = maxOutput;

  const input = modalities(held.input_modalities);
  if (input !== undefined) model.input = input;

  // The pool says what a model reasons at, not whether it reasons. A model with
  // nothing declared is one to offer without reasoning rather than one to guess
  // at, so this is the one fact here that Kira works out rather than copies.
  const levels = held.supported_reasoning_levels;
  if (Array.isArray(levels)) model.reasoning = levels.length > 0;

  return { model, offered, rank };
}

/** A string the pool meant as one, or nothing. */
function word(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A count the pool stated, or nothing: zero is not a count of anything here. */
function size(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The kinds of input a model takes, of the kinds pi's model entry knows. */
function modalities(value: unknown): ('text' | 'image')[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const known = value.filter(
    (kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image',
  );
  return known.length > 0 ? known : undefined;
}
