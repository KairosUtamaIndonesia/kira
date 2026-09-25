import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Configuration the server cannot start without, read once at boot. */
export interface Config {
  baseUrl: string;
  port: number;
  authSecret: string;
  databaseUrl: string;
  pool: {
    url: string;
    key: string;
  };
  allowance: {
    defaultTokens: number;
    timezone: string;
  };
  memory: {
    reflectionModel: string | null;
  };
  entra: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    authority: string;
  };
}

/**
 * Microsoft's commercial cloud, which is the only place Kira's tenant lives.
 * Better Auth's provider takes this as an option and defaults to the same
 * value; naming it here keeps the endpoint in one place, so a test can point
 * sign-in at a stand-in identity provider instead of reaching Microsoft.
 */
const ENTRA_AUTHORITY = 'https://login.microsoftonline.com';

/**
 * Authorities that admit accounts from anywhere. Better Auth defaults `tenantId`
 * to `common`, which is why a missing or wildcard tenant must stop the boot
 * rather than quietly widen who can sign in.
 */
const WILDCARD_TENANTS = new Set(['common', 'organizations', 'consumers']);

/** Better Auth's own floor for the cookie-signing secret. */
const MIN_SECRET_LENGTH = 32;

/**
 * The database Kira keeps its own state in: its users, their sessions, their
 * keys, and what each request used.
 *
 * The default is the development database `compose.yaml` runs, the way the pool
 * settings default to the development chain — so a checkout runs with nothing to
 * fill in. A deployed server sets it, and there it is a secret: the URL carries
 * the password. The port is Kira's own; `docs/internal/server-development.md`
 * says which one and why.
 */
export const DEFAULT_DATABASE_URL = 'postgres://kira:kira@127.0.0.1:5439/kira';

/**
 * The pool of provider logins model traffic goes through, and the key Kira
 * presents to it.
 *
 * Both defaults are the development chain rather than a guess: CLIProxyAPI on
 * its own default port, presenting the one key `scripts/dev-cliproxyapi.ts`
 * writes into that config. Neither is a secret — the key is a literal in that
 * script — so a checkout runs the documented chain with nothing to fill in. A
 * real deployment sets both, where the key is a secret and the pool key is not
 * a provider credential (docs/adr/0003-model-credentials.md).
 */
const DEFAULT_POOL_URL = 'http://127.0.0.1:8317';
const DEV_POOL_KEY = 'kira-dev-pool-key';

/** Where to listen when the base URL names no port, which means a proxy is in front. */
const DEFAULT_PORT = 3000;

/**
 * What a person is allowed when nobody has said otherwise.
 *
 * A heavy user's month is roughly ten to fifteen million tokens — thirty turns a
 * day at about twenty thousand in and three thousand out, over twenty days — so
 * this warns a heavy user near month end and still stops a runaway. Generous on
 * purpose: an allowance exists to stop one person draining the pool, not to
 * ration ordinary use (docs/adr/0005-allowances.md). A person who needs more has
 * a row of their own.
 */
const DEFAULT_ALLOWANCE_TOKENS = 20_000_000;

/**
 * The model Kira suggests for the reflecting, when a deployment names one.
 *
 * Left unset by default, and that is a decision rather than an omission. Which
 * model is cheapest is the thing a person would want suggested, and nothing
 * Kira can read knows a price: the pool is a proxy over subscription logins
 * rather than a priced catalog, and its catalog body carries no cost field at all
 * (docs/internal/research/cliproxyapi-interface.md). A deployment that has made
 * that judgement is the only party that can state it, so it states it here — and
 * a deployment that has not gets the pool's own first pick instead, which is the
 * order `/api/models` is already served in.
 */
const DEFAULT_REFLECTION_MODEL: string | null = null;

/**
 * Where the allowance month turns over. WIB, because that is where the people
 * subject to the allowance are; Indonesia has no daylight saving, so the
 * boundary is a fixed offset rather than a moving one.
 */
const ALLOWANCE_TIMEZONE = 'Asia/Jakarta';

const REQUIRED = 'is required';

/**
 * Read the environment into a `Config`, reporting every problem at once so one
 * run is enough to fix them.
 *
 * The environment is taken as an argument rather than read from `process.env`
 * here so a test can hand over any environment it likes.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = createEnv({
    server: {
      KIRA_ENTRA_TENANT_ID: z
        .string({ error: REQUIRED })
        .trim()
        .min(1, REQUIRED)
        .refine(
          (tenant) => !WILDCARD_TENANTS.has(tenant.toLowerCase()),
          "must be the company tenant's GUID; common, organizations and consumers accept accounts from any Microsoft tenant",
        ),
      KIRA_ENTRA_CLIENT_ID: z.string({ error: REQUIRED }).trim().min(1, REQUIRED),
      KIRA_ENTRA_CLIENT_SECRET: z.string({ error: REQUIRED }).trim().min(1, REQUIRED),
      KIRA_AUTH_SECRET: z
        .string({ error: REQUIRED })
        .trim()
        .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`),
      KIRA_BASE_URL: z
        .string({ error: REQUIRED })
        .trim()
        .min(1, REQUIRED)
        .refine(isAbsoluteUrl, 'must be an absolute URL'),
      KIRA_DATABASE_URL: z
        .string()
        .trim()
        .min(1, REQUIRED)
        .refine(isAbsoluteUrl, 'must be an absolute URL')
        .default(DEFAULT_DATABASE_URL),
      KIRA_POOL_URL: z
        .string()
        .trim()
        .min(1, REQUIRED)
        .refine(isAbsoluteUrl, 'must be an absolute URL')
        .default(DEFAULT_POOL_URL),
      KIRA_POOL_KEY: z.string().trim().min(1, REQUIRED).default(DEV_POOL_KEY),
      KIRA_DEFAULT_ALLOWANCE_TOKENS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_ALLOWANCE_TOKENS),
      KIRA_ALLOWANCE_TIMEZONE: z
        .string()
        .trim()
        .min(1, REQUIRED)
        .refine(isTimeZone, 'must be an IANA time zone name, such as Asia/Jakarta')
        .default(ALLOWANCE_TIMEZONE),
      KIRA_REFLECTION_MODEL: z.string().trim().min(1, REQUIRED).optional(),
    },
    runtimeEnv: env,
    // An empty value in a .env file means unset, not "set to an empty string",
    // so a blank line can never satisfy a required variable.
    emptyStringAsUndefined: true,
    // T3 Env's default logs the problems and throws a message naming none of
    // them. Whoever is starting the server needs the list.
    onValidationError: (issues) => {
      const problems = issues.map((issue) => `${String(issue.path?.[0])} ${issue.message}`);
      throw new Error(`Kira cannot start:\n  ${problems.join('\n  ')}`);
    },
  });

  return {
    baseUrl: parsed.KIRA_BASE_URL,
    port: listenPort(parsed.KIRA_BASE_URL),
    authSecret: parsed.KIRA_AUTH_SECRET,
    databaseUrl: parsed.KIRA_DATABASE_URL,
    pool: {
      url: parsed.KIRA_POOL_URL,
      key: parsed.KIRA_POOL_KEY,
    },
    allowance: {
      defaultTokens: parsed.KIRA_DEFAULT_ALLOWANCE_TOKENS,
      timezone: parsed.KIRA_ALLOWANCE_TIMEZONE,
    },
    memory: {
      reflectionModel: parsed.KIRA_REFLECTION_MODEL ?? DEFAULT_REFLECTION_MODEL,
    },
    entra: {
      tenantId: parsed.KIRA_ENTRA_TENANT_ID,
      clientId: parsed.KIRA_ENTRA_CLIENT_ID,
      clientSecret: parsed.KIRA_ENTRA_CLIENT_SECRET,
      authority: ENTRA_AUTHORITY,
    },
  };
}

/**
 * Where to listen. The browser has to reach the server at `baseUrl` — Microsoft
 * redirects it there — so the port comes from the base URL rather than from a
 * setting of its own, which could only drift out of agreement with it.
 */
function listenPort(baseUrl: string): number {
  const { port } = new URL(baseUrl);
  return port ? Number(port) : DEFAULT_PORT;
}

function isAbsoluteUrl(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this is a time zone the database will accept.
 *
 * Postgres would refuse an unknown one at the first query, which is the middle of
 * somebody's month rather than the moment they configured it.
 */
function isTimeZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}
