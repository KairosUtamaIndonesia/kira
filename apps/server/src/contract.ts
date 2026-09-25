/**
 * The server's shape, and the only thing it publishes.
 *
 * The routes and their answers are written once, in `app.ts`, as Elysia's own
 * schemas. This re-exports the type of the app those produce, so a client can
 * say what it expects rather than keeping a second copy of the same shapes by
 * hand and drifting from it. Nothing here runs at runtime: a client imports
 * this with `import type` and the import disappears from its build.
 *
 * It is deliberately the only subpath this package exports. A client reaching
 * `./app` would be able to import the server itself, and a browser bundle that
 * did would try to carry Elysia, Better Auth and a Postgres driver with it — so
 * the footgun is closed by construction rather than by remembering. A type-only
 * module has nothing to bundle.
 */
import type { createApp } from './app';

/** What every Kira client is typed against. */
export type App = ReturnType<typeof createApp>;

/**
 * One model, as `GET /api/models` offers it.
 *
 * Kira's own shape rather than pi's. The two would look alike, but pi's model
 * entry is a third-party library's internal type, and serving it would make a pi
 * upgrade into a Kira release: a client maps these onto whatever its own
 * entry requires, and fills what the pool did not state from its own defaults.
 *
 * Only what the pool stated is carried, so every field but the id may be absent.
 */
export interface CatalogModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  input?: ('text' | 'image')[];
  reasoning?: boolean;
}
