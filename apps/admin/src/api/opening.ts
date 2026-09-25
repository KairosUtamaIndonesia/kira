import { type Readings, readAllowance } from './allowances';
import { type Who, who } from './auth';
import { type ListedUser, listUsers } from './users';

/**
 * What the console found when it opened. One value rather than a set of flags, so
 * a screen cannot be drawn for a state that cannot happen — an administrator with
 * no user list, or a session that both is and is not an administrator.
 */
export type Opening =
  | { kind: 'signed-out' }
  | { kind: 'refused'; who: Who }
  | { kind: 'failed'; message: string }
  | {
      kind: 'admin';
      who: Who;
      users: ListedUser[];
      readings: Readings;
    };

/**
 * Read everything the console draws, in one pass, before it draws any of it.
 *
 * There is nothing to refresh afterwards: the two things that change the answer
 * are signing in, which leaves for Microsoft and comes back, and signing out,
 * which leaves on purpose — both load this page again, so a value read here is
 * still true for as long as it is on screen.
 */
export async function readOpening(): Promise<Opening> {
  const session = await who();
  if (!session.ok) return { kind: 'failed', message: session.message };
  if (session.value === null) return { kind: 'signed-out' };
  if (!session.value.admin) return { kind: 'refused', who: session.value };

  // Asked for only once there is someone allowed to ask: this is the request that
  // answers 403 for everyone else, and there is no reason to make it only to be
  // refused.
  const users = await listUsers();
  if (!users.ok) return { kind: 'failed', message: users.message };

  // One request per person, because the route answers about one person and a list
  // of them would be a second route to keep true. That is what a screenful costs;
  // a company that outgrows a screenful is the moment to add the list.
  const readings = Object.fromEntries(
    await Promise.all(
      users.value.map(async (user) => [user.id, await readAllowance(user.id)] as const),
    ),
  );

  return { kind: 'admin', who: session.value, users: users.value, readings };
}
