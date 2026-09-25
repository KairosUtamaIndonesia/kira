import { type Auth, createAuth } from './auth';
import { loadConfig } from './config';
import { migrate, openDatabase } from './database';

/** What came of asking, said as a value so the caller decides what to print. */
export type Granted = { granted: true } | { granted: false; reason: string };

/**
 * Make the person with this address an admin.
 *
 * The role is a fact about a Kira user, and the only way to hold it is to be
 * given it — which leaves the first one with nobody to give it. So this runs out
 * of band, with no session and no permission to check, and it is also what gets
 * an administrator back in when the last one has gone: the console can take the
 * role away from everyone, including itself (ADR 0007).
 *
 * A user row exists only once someone has signed in, which is what the refusal
 * says rather than inventing a user who has never been seen. Kira does not
 * mint the row itself: the identity is Entra's, and a row written here would be
 * a second one the same person signs into (ADR 0004).
 */
export async function grantAdmin(auth: Auth, email: string): Promise<Granted> {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(email);

  if (!found) {
    return { granted: false, reason: `${email} has not signed in yet` };
  }

  // The same write the admin plugin's own `set-role` makes, minus a permission
  // check: there is no session here to hold one, and that is the point.
  await context.internalAdapter.updateUser(found.user.id, { role: 'admin' });

  return { granted: true };
}

const USAGE = 'usage: bun run --cwd apps/server admin <email>';

/**
 * Grant the role, and say what happened in the caller's own terms.
 *
 * Returns the process's exit code rather than exiting, so what it decides can be
 * read by a test; binding a process is what the entry below does.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const email = argv[0];

  if (email === undefined || email.trim() === '') {
    console.error(USAGE);
    return 1;
  }

  // The same boot as `index.ts`, without a listener: the environment is read and
  // checked before anything is opened, and the database is brought up to date so
  // a fresh checkout can grant before a server has ever run.
  const config = loadConfig(process.env);

  const database = openDatabase(config.databaseUrl);
  await migrate(database);
  const auth = await createAuth(config, database);
  const result = await grantAdmin(auth, email);

  if (!result.granted) {
    console.error(`${result.reason}. Sign in from the desktop, then run this again.`);
    return 1;
  }

  console.log(`${email} is an admin.`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
