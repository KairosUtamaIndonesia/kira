import { and, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Config } from './config';
import type { Database } from './database';
import { keyHolder } from './keys';
import { REFUSAL, refusal } from './refusals';
import { allowance, usage } from './schema';

/**
 * Kira's allowances: how much of the pool one person may spend in a month
 * (docs/adr/0005-allowances.md).
 *
 * An allowance is a number of tokens per calendar month, and the month turns
 * over at Jakarta midnight — WIB, which is where the people subject to it are.
 * A default applies to everyone and a per-user row replaces it, so nobody is
 * ever unbudgeted and "how much does this person get" is one editable number.
 */
export interface AllowanceSettings {
  /** What a person is allowed when they have no override of their own. */
  defaultTokens: number;
  /** The zone the allowance month turns over in, by IANA name. */
  timezone: string;
}

/** What one person has spent in the allowance month they are in. */
export interface Standing {
  allowance: number;
  window: { start: string; end: string };
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What the allowance is spent on: input plus output. */
  used: number;
  /** True once somebody is close enough to their allowance to be told. */
  warned: boolean;
}

/** A request that was turned away, as somebody reading back over a month sees it. */
export interface Refusal {
  at: string;
  model: string;
  reason: string;
}

/**
 * Where a person is warned rather than stopped.
 *
 * A ceiling that arrives without notice reads as a fault, and the ADR decides
 * warn-then-refuse rather than either alone.
 */
const WARNED_AT = 0.8;

/** What one person is allowed: their own number, or the default for everyone. */
export async function allowanceFor(
  database: Database,
  userId: string,
  settings: AllowanceSettings,
): Promise<number> {
  return (await overrideFor(database, userId)) ?? settings.defaultTokens;
}

/** The number somebody was given, or null when the default applies to them. */
export async function overrideFor(database: Database, userId: string): Promise<number | null> {
  const [row] = await database
    .select({ tokensPerMonth: allowance.tokensPerMonth })
    .from(allowance)
    .where(eq(allowance.userId, userId));

  return row?.tokensPerMonth ?? null;
}

/**
 * Give somebody an allowance of their own, or take it away.
 *
 * Clearing the row is how a person goes back to the default. There is no number
 * that means "unlimited" and none that means "ask the default", so the absence
 * of a row is the only honest way to say it.
 */
export async function setAllowance(
  database: Database,
  userId: string,
  tokensPerMonth: number | null,
): Promise<void> {
  if (tokensPerMonth === null) {
    await database.delete(allowance).where(eq(allowance.userId, userId));
    return;
  }

  await database
    .insert(allowance)
    .values({ userId, tokensPerMonth })
    .onConflictDoUpdate({ target: allowance.userId, set: { tokensPerMonth } });
}

/**
 * Where one person stands in the month they are in: what they have spent, what
 * they are allowed, and the window both are measured in. `now` is a parameter
 * rather than `now()`, so a test can stand on either side of a month boundary.
 */
export async function standingFor(
  database: Database,
  userId: string,
  settings: AllowanceSettings,
  now: Date = new Date(),
): Promise<Standing> {
  const { start, end } = monthWindow(settings, now);

  const [row] = await database
    .select({
      // The window comes back as an instant in milliseconds rather than as a
      // timestamp: the driver parses a timestamp *column* into a Date, but an
      // expression it cannot type arrives as text, and text here would be a shape
      // to re-parse rather than a value to trust. Epoch milliseconds carry no
      // format to get wrong.
      windowStart: sql<string>`extract(epoch from ${start}) * 1000`,
      windowEnd: sql<string>`extract(epoch from ${end}) * 1000`,
      // Sums arrive as text, because that is what Postgres does with a big
      // integer; a request that used nothing is a row, so there is always a row
      // to sum rather than a missing one to interpret.
      // The sums are coalesced in the SQL, so what arrives is a number as text —
      // which is what Postgres does with a big integer. The `??` below is for the
      // type system alone: an aggregate with no group-by answers one row whatever
      // the table holds, so there is always a row here.
      inputTokens: sql<string>`coalesce(sum(${usage.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${usage.outputTokens}), 0)`,
      cacheReadTokens: sql<string>`coalesce(sum(${usage.cacheReadTokens}), 0)`,
      cacheWriteTokens: sql<string>`coalesce(sum(${usage.cacheWriteTokens}), 0)`,
    })
    .from(usage)
    .where(and(eq(usage.userId, userId), gte(usage.at, start), lt(usage.at, end)));

  const inputTokens = Number(row?.inputTokens ?? 0);
  const outputTokens = Number(row?.outputTokens ?? 0);
  const tokensPerMonth = await allowanceFor(database, userId, settings);
  const used = inputTokens + outputTokens;

  return {
    allowance: tokensPerMonth,
    window: {
      start: new Date(Number(row?.windowStart ?? now.getTime())).toISOString(),
      end: new Date(Number(row?.windowEnd ?? now.getTime())).toISOString(),
    },
    inputTokens,
    outputTokens,
    cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
    used,
    warned: used >= tokensPerMonth * WARNED_AT,
  };
}

/**
 * Whether a request of about this many tokens fits in what is left of somebody's
 * allowance.
 *
 * The rule lives here rather than in the route that asks it, because it is the
 * same policy the warning is measured against: a route reaching into a standing's
 * fields to apply half of an allowance is how the halves drift apart.
 */
export function fits(standing: Standing, askedFor: number): boolean {
  return standing.used + askedFor <= standing.allowance;
}

/**
 * The requests one person was refused in the month they are in.
 *
 * Kept apart from the standing rather than summed into it, because these are the
 * rows an operator reads to see *why* somebody is being turned away, and a count
 * is not an answer to that.
 */
export async function refusalsFor(
  database: Database,
  userId: string,
  settings: AllowanceSettings,
  now: Date = new Date(),
): Promise<Refusal[]> {
  const { start, end } = monthWindow(settings, now);

  const rows = await database
    .select({ at: usage.at, model: usage.model, reason: usage.reason })
    .from(usage)
    .where(
      and(
        eq(usage.userId, userId),
        eq(usage.outcome, 'refused'),
        gte(usage.at, start),
        lt(usage.at, end),
      ),
    )
    .orderBy(usage.id);

  return rows.map((row) => ({
    at: row.at.toISOString(),
    model: row.model,
    // A refusal is always written with a reason; the column is nullable because a
    // request that *was* sent has none, and the wire says that as an empty word.
    reason: row.reason ?? '',
  }));
}

/**
 * The month somebody is in, as two instants.
 *
 * Computed by the database rather than in JavaScript, because the zone's offset
 * is Postgres's to know: the month's first instant is a wall clock in Jakarta
 * converted back to an instant, which `AT TIME ZONE` does in both directions.
 * `now` is a parameter rather than `now()`, so a test can stand on either side of
 * a month boundary.
 */
function monthWindow(settings: AllowanceSettings, now: Date): { start: SQL; end: SQL } {
  return {
    start: sql`date_trunc('month', ${now}::timestamptz AT TIME ZONE ${settings.timezone}) AT TIME ZONE ${settings.timezone}`,
    end: sql`(date_trunc('month', ${now}::timestamptz AT TIME ZONE ${settings.timezone}) + interval '1 month') AT TIME ZONE ${settings.timezone}`,
  };
}

/**
 * What a person's month looks like, as both the desktop and the console read it.
 *
 * `override` is null when the default applies, which is the fact the console needs
 * to say "default" rather than showing the default as though somebody had chosen
 * it. `refusals` carries the rows rather than a count, because an operator's
 * question is *why* somebody is being turned away.
 */
const USAGE = t.Object({
  allowance: t.Number(),
  window: t.Object({ start: t.String(), end: t.String() }),
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  cacheReadTokens: t.Number(),
  cacheWriteTokens: t.Number(),
  used: t.Number(),
  warned: t.Boolean(),
  override: t.Union([t.Number(), t.Null()]),
  refusals: t.Array(t.Object({ at: t.String(), model: t.String(), reason: t.String() })),
});

/**
 * The allowance's own surface: what one person has spent, and what an operator may
 * see and change.
 *
 * Two credentials, deliberately (docs/adr/0005-allowances.md). A user reads their
 * own numbers with the key that identifies them, and an operator reads anybody's
 * with the console's session carrying the admin role. A key is not enough for the
 * operator's routes however privileged the person behind it: the console is the
 * surface that signs in, and it is the one that answers for what it changes.
 */
export function createAllowances({
  auth,
  config,
  database,
}: {
  auth: Auth;
  config: Config;
  database: Database;
}) {
  return (
    new Elysia()
      .get(
        '/api/usage',
        async ({ request, status }) => {
          const held = await keyHolder(auth, request);
          if ('refusal' in held) {
            return status(401, refusal(held.refusal.code, held.refusal.message));
          }

          return await readingFor(database, config, held.user.id);
        },
        {
          response: { 200: USAGE, 401: REFUSAL },
          detail: { summary: "A user's own usage against their allowance" },
        },
      )
      // Everything below the console is behind one question, asked once. The role
      // is the one Better Auth's admin plugin writes for an administrator, and the
      // one `grantAdmin` grants out of band (docs/adr/0007-admins.md).
      .guard({
        beforeHandle: async ({ request, status }) => {
          const session = await auth.api.getSession({ headers: request.headers });
          if (session === null) {
            return status(
              401,
              refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
            );
          }

          // The plugin's own `role` field, which the session's inferred type does
          // not carry: the auth instance is deliberately left unannotated, so
          // widening it cannot erase what Better Auth itself types (ADR 0008). The
          // field is on the user table and is what `grantAdmin` writes (ADR 0007).
          const role = (session.user as { role?: string | null }).role;
          if (role !== 'admin') {
            return status(
              403,
              refusal('NOT_AN_ADMIN', "Only an administrator can look at another person's usage."),
            );
          }
        },
      })
      .get(
        '/api/admin/usage/:userId',
        async ({ params, status }) => {
          if (!(await knownPerson(auth, params.userId))) {
            return status(404, refusal('USER_NOT_FOUND', 'No such person.'));
          }

          return await readingFor(database, config, params.userId);
        },
        {
          response: { 200: USAGE, 401: REFUSAL, 403: REFUSAL, 404: REFUSAL },
          detail: { summary: "Anybody's usage, for the console" },
        },
      )
      .put(
        '/api/admin/allowance/:userId',
        async ({ params, body, status }) => {
          if (!(await knownPerson(auth, params.userId))) {
            return status(404, refusal('USER_NOT_FOUND', 'No such person.'));
          }

          // Null is how an operator takes an override away, which is the only way
          // back to the default: no number means "ask the default".
          await setAllowance(database, params.userId, body.tokensPerMonth);

          return await readingFor(database, config, params.userId);
        },
        {
          body: t.Object({ tokensPerMonth: t.Union([t.Integer({ minimum: 1 }), t.Null()]) }),
          response: { 200: USAGE, 401: REFUSAL, 403: REFUSAL, 404: REFUSAL },
          detail: { summary: "Set or clear somebody's allowance" },
        },
      )
  );
}

/** What a person's month looks like, in one answer. */
async function readingFor(database: Database, config: Config, userId: string) {
  const now = new Date();

  return {
    ...(await standingFor(database, userId, config.allowance, now)),
    override: await overrideFor(database, userId),
    refusals: await refusalsFor(database, userId, config.allowance, now),
  };
}

/** Whether Kira knows this person, so an allowance is never set on nobody. */
async function knownPerson(auth: Auth, userId: string): Promise<boolean> {
  const context = await auth.$context;
  return (await context.internalAdapter.findUserById(userId)) !== null;
}
