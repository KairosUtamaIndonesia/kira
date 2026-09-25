import { auth } from './auth';
import { type Loaded, reasonFor } from './result';

/**
 * One person who has signed in, as much of them as the console lists.
 *
 * A type rather than an interface on purpose: the table below hands its rows out as
 * `Record<string, unknown>`, and only a type alias carries the implicit index
 * signature that satisfies it.
 */
export type ListedUser = {
  id: string;
  name: string;
  email: string;
  /** The ordinary role is `user`; a row written before the role existed has none. */
  role: string;
  banned: boolean;
};

/** How many are asked for at once. The plugin's own ceiling is higher. */
const PAGE = 100;

/**
 * Everyone who has signed in.
 *
 * This is the admin plugin's own list rather than one Kira writes: it already
 * answers with every user, their role and whether they are banned, and a second
 * endpoint saying the same thing would be a second thing to keep true.
 */
export async function listUsers(): Promise<Loaded<ListedUser[]>> {
  const { data, error } = await auth.admin.listUsers({ query: { limit: PAGE, sortBy: 'email' } });
  if (error) return { ok: false, message: reasonFor(error, 'Kira would not list its users.') };

  const users = data.users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    // Absent and `user` mean the same thing to everyone but an administrator, so
    // the list shows the ordinary role rather than a blank.
    role: user.role ?? 'user',
    banned: user.banned ?? false,
  }));

  return { ok: true, value: users };
}
