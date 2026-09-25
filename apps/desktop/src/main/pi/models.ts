/**
 * The models Kira runs on, which the server owns.
 *
 * pi has neither the credentials for them nor a list of them: the server holds
 * the provider logins and answers with what they can serve
 * (docs/adr/0003-model-credentials.md). This is the one place that knows so. It
 * presents this device's key to pi as `FOUNDRY_TOKEN`, registers Foundry as a
 * provider of pi's own, and hands a session the runtime and the model to run on.
 *
 * What the server last served is written down, because nothing else keeps it: a
 * registered provider's models live on the runtime and nowhere else, so a cold
 * start with no network would otherwise have nothing to run. It is the server's
 * answer that decides and this that remembers — and a server that cannot be
 * asked leaves what is remembered exactly as it was, because "I could not ask"
 * and "there are none" are different facts, and only one of them is worth
 * forgetting a working list over.
 */
import { ModelRuntime, type ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import type { CatalogModel } from '@foundry/server/contract';
import { readFile, rename, writeFile } from 'node:fs/promises';

/** The provider id Foundry is registered under, which pi has no credential for. */
const PROVIDER = 'foundry';

/** Where pi looks for the key this device presents (docs/adr/0003-model-credentials.md). */
const KEY_VARIABLE = 'FOUNDRY_TOKEN';

/**
 * What pi assumes when the server did not say.
 *
 * pi's own defaults, filled in only because its model entry requires the fields:
 * a model that arrives without a context window is run exactly as one of pi's
 * own that never stated one would be. Guessing better than pi would be guessing
 * a fact the pool did not offer.
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * What the server answered when asked what it can serve.
 *
 * A 200 carries its document as it arrived rather than a parsed catalog, because
 * this module reads both that and the copy kept on disk with one reader — so the
 * shape is understood in one place. A server that could not answer at all is the
 * other case, and it is a different fact from an answer of none.
 */
export type CatalogAnswer = { kind: 'ok'; body: unknown } | { kind: 'unavailable' };

/** The model pi resolved, which is the entry a session is built around. */
type SessionModel = NonNullable<ReturnType<ModelRuntime['getModel']>>;

/** The runtime every session shares, and the model a session runs on. */
export interface ModelChoice {
  runtime: ModelRuntime;
  model: SessionModel;
}

export interface ModelsDeps {
  /** The Foundry server, whose `/v1` is where this provider's traffic goes. */
  server: string;
  /** Where the catalog the server last served is remembered. */
  cachePath: string;
  /** The key this device holds, or null when nobody has signed in. */
  token(): Promise<string | null>;
  /** Ask the server which models it can serve. */
  catalog(token: string): Promise<CatalogAnswer>;
}

export interface Models {
  /** The models Foundry offers, in the pool's own order. */
  catalog(): Promise<CatalogModel[]>;
  /**
   * What a session runs on when the chat has not chosen one, or null when
   * Foundry is offering nothing to run.
   */
  preferred(): Promise<ModelChoice | null>;
  /** The model `id` names, or null when Foundry no longer offers it. */
  find(id: string): Promise<ModelChoice | null>;
  /** The model `id` names, refusing when Foundry is not offering it. */
  want(id: string): Promise<ModelChoice>;
  /** Ask the server again, and remember what it says. */
  refresh(): Promise<void>;
}

export function foundryModels({ server, cachePath, token, catalog }: ModelsDeps): Models {
  let shared: Promise<ModelRuntime> | undefined;
  let remembered: CatalogModel[] | undefined;

  /**
   * The fetch the hook is in the middle of, if one is.
   *
   * pi's own refresh is not a promise that this finished. It begins a refresh of
   * its own whenever a provider is registered, and a refresh that supersedes one
   * already in flight resolves as soon as it begins — leaving the fetch it caused
   * still running. `refresh()` waits for this instead, because a caller that
   * picks a model the moment a refresh returns is relying on the catalog having
   * landed, and the cache having been written with it.
   */
  let fetching: Promise<ProviderModelConfig[]> | undefined;

  /** The models the server last served, read from the cache the first time. */
  async function known(): Promise<CatalogModel[]> {
    remembered ??= await rememberedIn(cachePath);
    return remembered;
  }

  /** The key, presented where pi will look for it. */
  async function present(): Promise<string | null> {
    const key = await token();
    if (key === null) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = key;

    return key;
  }

  /** The one runtime the app's sessions run on, registered when first asked for. */
  function sharedRuntime(): Promise<ModelRuntime> {
    shared ??= register();
    return shared;
  }

  async function register(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create();

    // `models` is not optional in practice: registration makes a model
    // selectable at once, and pi reads the composed list synchronously, so a
    // provider registered without them has nothing to choose — which is why what
    // was remembered is passed here rather than left to the first refresh.
    //
    // The id is Foundry's own, and pi holds no credential for it, which is what
    // makes local credential resolution unreachable rather than merely unused
    // (docs/adr/0003-model-credentials.md).
    runtime.registerProvider(PROVIDER, {
      api: 'openai-completions',
      baseUrl: `${server}/v1`,
      apiKey: `$${KEY_VARIABLE}`,
      models: entriesIn(await known()),
      refreshModels: async (context) => {
        // pi asks twice: once to restore what it holds without touching the
        // network, and again only once a credential resolved. What this holds is
        // what the server last said, so the first answer is the list already in
        // use — answering it from anywhere else would be a second list.
        if (context.allowNetwork !== true) return entriesIn(await known());

        const key = await present();
        if (key === null) throw new Error('Foundry has no key to ask for its models with.');

        // Kept and returned as a promise of its own, so that a refresh has
        // something to wait for that means "this fetch finished" rather than
        // "pi stopped waiting for it".
        fetching = (async () => {
          const answer = await catalog(key);
          if (answer.kind === 'unavailable') {
            // Thrown rather than answered empty, because pi replaces its list with
            // what comes back and an empty list erases every model. This way what
            // the machine already had is kept.
            throw new Error('Foundry could not say which models it can serve.');
          }

          const models = modelsIn(answer.body);
          if (models === null) {
            // An answer that is not a catalog is the same fact as no answer: there
            // is nothing here to replace the list in use with.
            throw new Error('Foundry answered with something that is not a catalog.');
          }

          remembered = models;
          await remember(cachePath, models).catch((problem: unknown) => {
            // The models are in hand either way; only the next cold start is worse
            // off, which is not worth failing a refresh over.
            console.error('[foundry] the catalog was not written down:', problem);
          });

          return entriesIn(models);
        })();

        return fetching;
      },
    });

    return runtime;
  }

  /**
   * A catalog entry as the runtime's model, or null when there is nothing to run.
   *
   * `getModel` answers nothing for an id the runtime does not hold, which is the
   * same fact as an entry that is not there at all: the provider's list is what
   * was registered, and it is registered from this one catalog.
   */
  async function choiceIn(entry: CatalogModel | undefined): Promise<ModelChoice | null> {
    if (entry === undefined) return null;

    const runtime = await sharedRuntime();
    const model = runtime.getModel(PROVIDER, entry.id);
    if (model === undefined) return null;

    return { runtime, model };
  }

  /** The model `id` names, or null when the catalog does not hold it. */
  async function choiceFor(id: string): Promise<ModelChoice | null> {
    await present();
    return choiceIn((await known()).find((each) => each.id === id));
  }

  return {
    async catalog() {
      // A copy, because what is remembered is the list the provider was
      // registered from: a caller that sorted or trimmed this in place would be
      // editing the models in use.
      return [...(await known())];
    },

    async preferred() {
      await present();

      // The first of them, because the order is the server's: the pool ranks the
      // models it serves, and that ranking is what says which one a person
      // should be given when they have not chosen one
      // (apps/server/src/pool.ts).
      return choiceIn((await known())[0]);
    },

    find: choiceFor,

    async want(id) {
      const choice = await choiceFor(id);

      // One sentence, in one place: a caller that needs the model to exist and a
      // caller that can carry on without it differ in what they do about this,
      // not in how they say it.
      if (choice === null) throw new Error(`Foundry is not offering ${id}.`);

      return choice;
    },

    async refresh() {
      // Nobody has signed in, so there is nothing to ask with. pi reaches the
      // hook below even with no credential to resolve, which would leave an
      // error in the log for a machine that has simply not signed in yet.
      if ((await present()) === null) return;

      // Refreshed through pi rather than beside it, because the list pi holds is
      // the one a session was built from: the hook above is what fetches, and
      // this is what asks it to.
      try {
        const { errors } = await (
          await sharedRuntime()
        ).refresh({
          allowNetwork: true,
          providers: [PROVIDER],
        });

        for (const problem of errors.values()) {
          console.error('[foundry] the catalog was not refreshed:', problem);
        }
      } catch (problem: unknown) {
        console.error('[foundry] the catalog was not refreshed:', problem);
      }

      // Waiting for the fetch rather than trusting pi's promise, which a
      // superseding refresh can resolve early. A failure here is already in
      // `errors` above, so it is not reported twice.
      await fetching?.catch(() => {});
    },
  };
}

/**
 * The models pi runs, out of the models Foundry offers.
 *
 * Every field pi requires is filled, from what the server said where it said
 * anything and from pi's own defaults where it did not. Cost is the one thing
 * the pool never states: a price invented on this side would be a number
 * somebody acts on (docs/adr/0005-allowances.md), so it is zero, which is what
 * pi means by a model whose price it does not know.
 */
function entriesIn(models: CatalogModel[]): ProviderModelConfig[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxOutput ?? DEFAULT_MAX_TOKENS,
  }));
}

/**
 * The models in a catalog document, or null when it is not one.
 *
 * One reader for both the server's answer and the file this writes, because they
 * are the same document: what is remembered is what arrived. An entry that names
 * no model is left out rather than the rest being refused, which is where this
 * differs from the server, where a catalog holding an entry it cannot read is
 * refused whole. The server can be asked again, and can be asked for everything
 * it has; a desktop with half a catalog can still run, and one with none cannot.
 */
function modelsIn(document: unknown): CatalogModel[] | null {
  const listed = (document as { models?: unknown } | null)?.models;
  if (!Array.isArray(listed)) return null;

  const models: CatalogModel[] = [];
  for (const entry of listed) {
    if (typeof entry !== 'object' || entry === null) continue;

    const held = entry as Record<string, unknown>;
    if (typeof held.id !== 'string' || held.id === '') continue;

    const model: CatalogModel = { id: held.id };

    if (typeof held.name === 'string' && held.name !== '') model.name = held.name;

    const contextWindow = aCount(held.contextWindow);
    if (contextWindow !== undefined) model.contextWindow = contextWindow;

    const maxOutput = aCount(held.maxOutput);
    if (maxOutput !== undefined) model.maxOutput = maxOutput;

    if (Array.isArray(held.input)) {
      const input = held.input.filter(
        (kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image',
      );
      if (input.length > 0) model.input = input;
    }

    if (typeof held.reasoning === 'boolean') model.reasoning = held.reasoning;

    models.push(model);
  }

  return models;
}

/** A count, or nothing: zero is not a count of anything here. */
function aCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * What was remembered, or nothing, for every way a cache can come to nothing.
 *
 * A missing, unreadable or no-longer-a-catalog file is not a failure: it is a
 * machine that has not been told yet, and the server is asked. Nothing is
 * deleted on the way past, because a file that cannot be read this morning is
 * not one that can never be read (docs/adr/0006-key-storage.md).
 */
async function rememberedIn(path: string): Promise<CatalogModel[]> {
  try {
    return modelsIn(JSON.parse(await readFile(path, 'utf8'))) ?? [];
  } catch {
    return [];
  }
}

/** Write the catalog down in one piece: a half-written file is not a catalog. */
async function remember(path: string, models: CatalogModel[]): Promise<void> {
  const writing = `${path}.writing`;
  await writeFile(writing, JSON.stringify({ models }));
  await rename(writing, path);
}
