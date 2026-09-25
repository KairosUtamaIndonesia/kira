import { createHash, randomBytes } from 'node:crypto';
import { type AddressInfo, createServer } from 'node:net';
import { Client } from 'pg';
import { createApp } from '../app';
import { type Auth, createAuth } from '../auth';
import { type Config, loadConfig } from '../config';
import { type Database, migrate, openDatabase } from '../database';
import { OUTCOME, recordUsage } from '../usage';
import { type EntraAccount, startFakeEntra } from './fake-entra';

export const TENANT = '11111111-2222-3333-4444-555555555555';
export const ORIGIN = 'http://localhost:3000';

export const ENV = {
  KIRA_ENTRA_TENANT_ID: TENANT,
  KIRA_ENTRA_CLIENT_ID: 'client-id',
  KIRA_ENTRA_CLIENT_SECRET: 'client-secret',
  KIRA_AUTH_SECRET: 'a'.repeat(32),
  KIRA_BASE_URL: ORIGIN,
};

/** A server with a database of its own, as it would be at boot. */
export async function boot(
  entra: Partial<Config['entra']> = {},
  pool: Partial<Config['pool']> = {},
  memory: Partial<Config['memory']> = {},
) {
  const config = configured(ENV, entra, pool, memory);
  const database = await freshDatabase(config.databaseUrl);
  await migrate(database);
  const auth = await createAuth(config, database);

  // The connection comes back with the rest: Kira's own tables live in the
  // same database as Better Auth's, so a test that touches them needs it.
  return { config, auth, database, app: createApp({ auth, config, database }) };
}

/**
 * A server actually listening, for the journeys that call back into it.
 *
 * The desktop's sign-in starts at an endpoint that the server reaches over
 * HTTP itself, so a journey through it cannot be driven by handing requests to
 * the app object: there has to be a port to answer.
 */
export async function listen(entra: Partial<Config['entra']> = {}) {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const config = configured({ ...ENV, KIRA_BASE_URL: origin }, entra);
  const database = await freshDatabase(config.databaseUrl);
  await migrate(database);
  const auth = await createAuth(config, database);
  const app = createApp({ auth, config, database }).listen(config.port);

  // Listening is asynchronous, and the journey's first step is a real request,
  // so wait for the server to answer rather than for a clock to run out.
  await waitFor(() => fetch(`${origin}/health`).then((response) => response.ok), 'the server');

  // The connection comes back with the rest, as it does from `boot`: a journey
  // through the app is still a journey about rows in Kira's own tables.
  return { config, auth, app, database, origin, stop: () => app.stop() };
}

function configured(
  env: Record<string, string>,
  entra: Partial<Config['entra']>,
  pool: Partial<Config['pool']> = {},
  memory: Partial<Config['memory']> = {},
) {
  const base = loadConfig(env);
  return {
    ...base,
    entra: { ...base.entra, ...entra },
    pool: { ...base.pool, ...pool },
    memory: { ...base.memory, ...memory },
  };
}

/**
 * A database with nothing in it, for one boot.
 *
 * Every boot re-migrates from empty, so no test can see another's rows and the
 * statements that run are the ones production runs — `openDatabase` and
 * `migrate`, called exactly as `index.ts` calls them.
 *
 * It is not a database of its own, which is what this used to do and what
 * measured at 353 of them and 2.8GB on the development instance. Creating one
 * cost 66ms and *dropping* it cost 180ms — enough that a file's teardown
 * outlasted the time a test runner allows a hook, so the tidying silently did
 * not happen. Putting one database back to nothing costs 88ms, leaves nothing
 * behind if it fails, and needs no teardown at all.
 */
export async function freshDatabase(url: string): Promise<Database> {
  const database = openDatabase(await testDatabase(url));

  await database.$client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await database.$client.query('CREATE SCHEMA public');
  // The journal is what says the migrations have been applied. Left in place,
  // the migration below would find nothing to do and the schema would stay gone.
  await database.$client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');

  await migrate(database);
  made.push(database);

  return database;
}

/** The connections this file opened, so the end of it can let them go. */
const made: Database[] = [];

/**
 * A test file calls this from its own `afterAll`, so the connections it opened are
 * let go when it ends.
 *
 * It cannot be registered in this file instead: a test runner spreads a suite across
 * files and evaluates a module once, so a hook written here would run for whichever
 * file imported it first and silently not for the others. That is not a guess about
 * how runners behave — it is what the previous arrangement did, and what let a leak
 * of hundreds of databases go unnoticed.
 *
 * What it does is small. Closing a connection is immediate and there is no database
 * to remove, because the cost of removing one is what made the last attempt fail.
 */
export async function closeDatabases(): Promise<void> {
  for (const database of made) await database.$client.end();

  made.length = 0;
}

/** Where tests keep their tables, made once if it is not already there. */
const TEST_DATABASE = 'kira_test';

/** The database tests use, coming into existence if this is a fresh machine. */
async function testDatabase(baseUrl: string): Promise<string> {
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();

  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    TEST_DATABASE,
  ]);

  if (existing.rowCount === 0) {
    try {
      await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
    } catch (error) {
      // Two files in two processes can both find it missing. One of them loses
      // the race, and that is the one thing here that is not a failure.
      if ((error as { code?: string }).code !== '42P04') throw error;
    }
  }

  await admin.end();

  return atDatabase(baseUrl, TEST_DATABASE);
}

/** The same server, a named database on it. */
function atDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;

  return parsed.toString();
}

/** A port nothing else holds, released so the server can take it. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  return port;
}

/** Wait until `condition` holds, rather than for a fixed span of time. */
export async function waitFor(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();

  while (!(await condition().catch(() => false))) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`waited ${timeoutMs}ms for ${description}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * A listening server beside a stand-in Microsoft, stopped together.
 *
 * The two halves a journey through the app needs: a real port that answers, and an
 * identity provider that signs the same person in every time.
 */
export async function listening(account: EntraAccount) {
  const entra = await startFakeEntra(account);
  const server = await listen({ authority: entra.authority });

  return {
    ...server,
    askedOfMicrosoft: entra.authorizations,
    stop: async () => {
      await server.stop();
      await entra.stop();
    },
  };
}

/**
 * A request already behind somebody, as the ledger keeps one.
 *
 * The setup half of most allowance tests: what somebody has spent decides what
 * they are allowed to do next, and the request that spent it is not the subject.
 */
export async function spent(
  database: Database,
  userId: string,
  tokens: {
    inputTokens: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    at?: string;
  },
): Promise<void> {
  await recordUsage(database, {
    userId,
    model: 'fake-model',
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outcome: OUTCOME.ok,
    at: new Date().toISOString(),
    ...tokens,
  });
}

/**
 * Sign in as the stand-in Microsoft's person, and come back with the session the
 * console would carry.
 *
 * This is the front half of the journey the desktop walks: the server sends the
 * browser to Microsoft, Microsoft sends it back, and the callback leaves a session
 * behind. The desktop's own handoff — the root, and the token in the deep link —
 * comes after this and only the desktop needs it. A stand-in Microsoft has to be
 * listening for this to answer.
 */
export async function consoleSession(origin: string): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const started = await fetch(
    `${origin}/api/auth/electron/init-oauth-proxy?provider=microsoft&state=${state}&code_challenge=${challenge}`,
    { redirect: 'manual' },
  );
  const toMicrosoft = started.headers.get('location');
  if (!toMicrosoft) throw new Error('sign-in did not reach Microsoft');

  const atMicrosoft = await fetch(toMicrosoft, { redirect: 'manual' });
  const backToKira = atMicrosoft.headers.get('location');
  await atMicrosoft.body?.cancel();
  if (!backToKira) throw new Error('Microsoft did not send the browser back');

  const signedIn = await fetch(new URL(backToKira), {
    redirect: 'manual',
    headers: { cookie: cookieHeader(started) },
  });

  const cookie = cookieHeader(signedIn);
  if (cookie === '') throw new Error('signing in left no session behind');

  return cookie;
}

/** A user as sign-in would leave one, without reaching Microsoft. */
export async function user(auth: Auth, email = 'ada@company.example') {
  const context = await auth.$context;
  return context.internalAdapter.createUser(
    { email, name: 'Ada Lovelace', emailVerified: true },
    { method: 'oauth', oauth: { providerId: 'microsoft' } },
  );
}

/** A device key, as issuing one would leave it. */
export function issue(auth: Auth, userId: string, name: string) {
  return auth.api.createApiKey({ body: { userId, name } });
}

export function send(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) {
  return app.handle(new Request(`${ORIGIN}${path}`, init));
}

export function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

/** The `name=value` of every cookie a response sets, as a request would send them. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}
