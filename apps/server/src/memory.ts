/**
 * What one person decided about memory, and the route they decide it through.
 *
 * Two questions, both the person's: whether the observational-memory workers run
 * at all, and which model does the reflecting. They live here rather than on a
 * machine because they are the account's own — the same answer on every desktop
 * somebody signs in on — and because the server is the only party that can answer
 * the third question this route is asked, which is what Kira would suggest to
 * somebody who would rather not choose (GH #43).
 *
 * Memory is not compaction. Turning it off stops the observer and the reflector;
 * a chat still compacts, deterministically and visibly, and Kira can still read
 * back what compaction dropped. Those two are separate on purpose — a summary is
 * recomputed from the conversation rather than remembered — so this route only
 * ever decides the remembering.
 */
import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { CatalogModel } from './contract';
import type { Database } from './database';
import { keyHolder } from './keys';
import { poolAnswer, poolCatalog } from './pool';
import { refusal, REFUSAL } from './refusals';
import { memory } from './schema';

/** What somebody has decided, as the database holds it: null is nothing said. */
export interface MemoryRecord {
  enabled: boolean | null;
  chosen: string | null;
}

/**
 * What this person decided, or nothing said about either question.
 *
 * A row is a decision rather than a value: the absence of one is not the same
 * fact as a decision to keep nothing, which is why neither column is defaulted
 * (docs/adr/0005-allowances.md has the same reasoning for an allowance).
 */
export async function memoryFor(database: Database, userId: string): Promise<MemoryRecord> {
  const [row] = await database
    .select({ enabled: memory.enabled, chosen: memory.reflectingModel })
    .from(memory)
    .where(eq(memory.userId, userId));

  return { enabled: row?.enabled ?? null, chosen: row?.chosen ?? null };
}

/** Write down what they decided, replacing whatever was decided before. */
export async function setMemory(
  database: Database,
  userId: string,
  decided: MemoryRecord,
): Promise<void> {
  const held = { userId, enabled: decided.enabled, reflectingModel: decided.chosen };

  await database
    .insert(memory)
    .values(held)
    .onConflictDoUpdate({
      target: memory.userId,
      set: { enabled: held.enabled, reflectingModel: held.reflectingModel },
    });
}

/**
 * What a person is told: their two answers, and what Kira would suggest.
 *
 * `chosen` and `recommended` are apart rather than one effective model on purpose.
 * A window handed only the effective one could not tell a choice from a
 * suggestion, and the first thing it does with it is save it back — which would
 * pin today's suggestion into the person's own setting, and a deployment that
 * later names another model would no longer reach them. `chosen ?? recommended` is
 * the model that reflects, and it is nobody else's business which of the two it is.
 */
const SETTINGS = t.Object({
  enabled: t.Boolean(),
  chosen: t.Union([t.String(), t.Null()]),
  recommended: t.Union([t.String(), t.Null()]),
});

export function createMemory({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return new Elysia()
    .get(
      '/api/memory',
      async ({ request, status }) => {
        const held = await keyHolder(auth, request);
        if ('refusal' in held) {
          return status(401, refusal(held.refusal.code, held.refusal.message));
        }

        return await settingsFor(database, config, held.user.id);
      },
      {
        response: { 200: SETTINGS, 401: REFUSAL },
        detail: { summary: "Somebody's own memory settings, and what Kira suggests" },
      },
    )
    .put(
      '/api/memory',
      async ({ request, body, status }) => {
        const held = await keyHolder(auth, request);
        if ('refusal' in held) {
          return status(401, refusal(held.refusal.code, held.refusal.message));
        }

        const catalog = await poolCatalog(config);

        // A model of their own is checked against the pool before it is stored: a
        // chat cannot run on a model the pool is not offering, and a setting that
        // later starts a session it cannot start is worse than a refusal now. The
        // two ways of not knowing are the pool's own, so they are refused in the
        // pool's own words.
        if (body.chosen !== null) {
          const answer = poolAnswer(catalog);
          if (answer.kind === 'refused') {
            return status(502, refusal(answer.code, answer.message));
          }
        }

        if (
          body.chosen !== null &&
          catalog.kind === 'ok' &&
          !catalog.models.some((each) => each.id === body.chosen)
        ) {
          return status(
            400,
            refusal('MODEL_NOT_OFFERED', `The pool is not offering ${body.chosen}.`),
          );
        }

        await setMemory(database, held.user.id, { enabled: body.enabled, chosen: body.chosen });

        return await settingsFor(database, config, held.user.id);
      },
      {
        body: t.Object({ enabled: t.Boolean(), chosen: t.Union([t.String(), t.Null()]) }),
        response: { 200: SETTINGS, 400: REFUSAL, 401: REFUSAL, 502: REFUSAL },
        detail: { summary: 'Decide whether memory runs, and which model reflects' },
      },
    );
}

/**
 * The two answers, and what Kira suggests.
 *
 * Memory runs unless somebody turned it off, and a model of their own only counts
 * while the pool still offers it: one the pool has dropped is not a model any chat
 * can run on, so it is no choice at all and it is reported as none rather than as
 * a choice — the suggestion stands in again, and a window never draws a model that
 * has gone.
 *
 * The read is never a refusal over the pool, deliberately. What a person decided
 * is in this database whether or not the pool is reachable, and the only thing
 * missing when it is not is the suggestion — so a person whose pool is down can
 * still see and change their own answer.
 */
async function settingsFor(database: Database, config: Config, userId: string) {
  const held = await memoryFor(database, userId);
  const catalog = await poolCatalog(config);
  const offered = catalog.kind === 'ok' ? catalog.models : [];

  const recommended = recommendedIn(offered, config.memory.reflectionModel);
  const chosen =
    held.chosen !== null && offered.some((each) => each.id === held.chosen) ? held.chosen : null;

  return { enabled: held.enabled ?? true, chosen, recommended };
}

/**
 * Which model Kira suggests for the reflecting.
 *
 * There is no price to rank by. The pool is a proxy over subscription logins
 * rather than a priced catalog, and its own catalog body carries no cost field at
 * all — read from the running pool rather than assumed
 * (docs/internal/research/cliproxyapi-interface.md) — so "the cheapest model" is
 * not a number Kira can work out. The suggestion is therefore the model the
 * deployment names for it, and failing that the model the pool itself puts first:
 * the pool is the party that decides what its models are for, and its order is
 * already what `/api/models` serves.
 *
 * Whichever it is, it is only a suggestion. The person chooses, and nothing here
 * binds them to it.
 */
function recommendedIn(offered: readonly CatalogModel[], named: string | null): string | null {
  if (named !== null && offered.some((each) => each.id === named)) return named;

  return offered[0]?.id ?? null;
}
