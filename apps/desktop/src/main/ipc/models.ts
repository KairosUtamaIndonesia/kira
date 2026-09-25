/**
 * The models channel's handlers.
 *
 * Two things the window cannot answer for itself. Which models Foundry is
 * offering lives with the provider registration in this process, and pi keeps no
 * copy a window can read; and which one a chat runs on is a change to a live
 * session rather than a value, so it is asked for rather than set.
 *
 * The order is the pool's own and so are the ids, so nothing here decides which
 * model is best; the one thing it does decide is what a model the pool did not
 * name is called, which is by the id it is asked for by.
 */
import type { CatalogModel } from '@foundry/server/contract';
import { MODELS_CHANNELS, type ModelOption, type Result } from '../../preload/bridge.ts';
import { envelope, withId } from './result.ts';

export { MODELS_CHANNELS };

/** What the handlers need from the main process. */
export interface ModelDeps {
  /** The models Foundry offers, in the pool's own order. */
  offered(): Promise<CatalogModel[]>;
  /** Run the chat on screen on the model `modelId` names. */
  choose(modelId: string): Promise<void>;
}

export interface ModelHandlers {
  load(): Promise<Result<ModelOption[]>>;
  choose(modelId: unknown): Promise<Result<null>>;
}

/**
 * A model as the window sees it.
 *
 * The id is what a model is asked for by and the name is what the pool calls it;
 * a model the pool did not name is called by its id, which is the same thing pi's
 * own entry does with it.
 */
function optionIn(model: CatalogModel): ModelOption {
  return { id: model.id, name: model.name ?? model.id };
}

export function modelHandlers({ offered, choose }: ModelDeps): ModelHandlers {
  return {
    load: () => envelope(async () => (await offered()).map(optionIn)),
    choose: (modelId) => withId(modelId, 'A model needs an id.', choose),
  };
}
