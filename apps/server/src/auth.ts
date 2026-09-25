import { apiKey } from '@better-auth/api-key';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { electron } from '@better-auth/electron';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import type { Config } from './config';
import type { Database } from './database';
import { DESKTOP_SCHEME } from './handoff';
import { schema } from './schema';

/**
 * Where the administration console listens while it is being developed, served by
 * Vite rather than by this process. The port is fixed in its own config
 * (`apps/admin/vite.config.ts`) so that it is this origin and no other, and the two
 * have to agree — an origin carries its port.
 *
 * It is here rather than in the environment because production needs no entry: the
 * console is then served from the base URL, whose origin Better Auth already
 * trusts. This is the development case only, so it is named where the desktop's
 * own scheme is named — as a fact about how Foundry is run, not a setting.
 *
 * It matters for every request that carries a session cookie, which is the console's
 * whole write surface: signing out, and setting a role later. Signing in carries
 * none, so an address missing from this list fails at the end of a session rather
 * than at the start of one.
 */
const ADMIN_DEV_ORIGIN = 'http://localhost:4101';

/**
 * Ninety days. A key's value is fixed at creation, so there is nothing to
 * rotate in place; the expiry is the backstop that bounds a key nobody
 * remembers to revoke, and signing in again issues a fresh one.
 *
 * Seconds, because the plugin passes this through `getDate(..., "sec")`. Its
 * own type comment says milliseconds, which would be a 1000x lifetime.
 */
const KEY_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export type Auth = Awaited<ReturnType<typeof createAuth>>;

/**
 * Build the auth instance.
 *
 * It does not create its own tables. Better Auth's tables and Foundry's are one
 * schema with one set of statements (`src/schema.ts`, applied by `migrate()`),
 * so the server says what the database should look like in one place instead of
 * running two migrations that each own half of it. Better Auth reaches them
 * through its Drizzle adapter, which is what keeps it from migrating them
 * itself.
 */
export async function createAuth(config: Config, database: Database) {
  return betterAuth(authOptions(config, database));
}

// Left unannotated on purpose: widening this to `BetterAuthOptions` would erase
// the plugin's own API, taking `verifyApiKey` off the type.
function authOptions(config: Config, database: Database) {
  return {
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema,
      // Postgres has transactions, and Better Auth's writes are multi-step — a
      // session and its user, a key and its counters. The adapter does not assume
      // they are available, so it is told.
      transaction: true,
    }),
    secret: config.authSecret,
    baseURL: config.baseUrl,
    socialProviders: {
      microsoft: {
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        // The tenant is the authorisation boundary: pinning it scopes both the
        // authorize and token endpoints to that one tenant, and Microsoft's own
        // endpoints are what refuse an account from anywhere else. Note this is
        // not the issuer claim — the callback redeems the code against the
        // tenant-scoped token endpoint and never verifies the id_token.
        tenantId: config.entra.tenantId,
        authority: config.entra.authority,
        // A Graph call on every sign-in, for an avatar nothing displays, and one
        // more external dependency between a user and a session.
        disableProfilePhoto: true,
      },
    },
    plugins: [
      apiKey({
        // A key names a device, which is what makes one machine revocable.
        requireName: true,
        keyExpiration: { defaultExpiresIn: KEY_LIFETIME_SECONDS },
        // The plugin otherwise allows ten requests a day per key, which would
        // stop a real conversation mid-turn. A user's allowance (ADR 0005) is
        // the quota authority, not this.
        rateLimit: { enabled: false },
      }),
      // The server half of the desktop handoff: it carries the browser's
      // sign-in back to the app over a custom-protocol deep link, by a
      // one-time code with its own short expiry (ADR 0004).
      electron(),
      // Who may administer Foundry (ADR 0007). Signing in proves which employee
      // someone is, never that they run the place, so the role this adds is a
      // second question the tenant cannot answer. The console gates on it and
      // sets it; the first admin is granted out of band — see `admin.ts` —
      // because nobody holds the role until someone says so.
      admin(),
    ],
    // The desktop presents requests from its own scheme as the origin, and the
    // console one from the port its dev server listens on. The base URL's own
    // origin needs no entry: Better Auth trusts it already, which is what covers
    // the console in production, where this process serves it.
    trustedOrigins: [`${DESKTOP_SCHEME}:/`, ADMIN_DEV_ORIGIN],
  };
}
