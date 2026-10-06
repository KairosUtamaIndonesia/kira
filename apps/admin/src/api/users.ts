import { treaty } from '@elysiajs/eden';
import type { App } from '@kira/server/contract';
import { auth } from './auth';
import { type Loaded, reasonFor } from './result';

const kira = treaty<App>(window.location.origin);

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

/**
 * Grant or remove a person's admin role.
 *
 * The console asks Kira rather than Better Auth directly: the write and its audit
 * row are one act on the server, and the last-administrator guard is the server's
 * too, so a refusal arrives as a sentence rather than as a button that did nothing.
 */
export async function setRole(
  userId: string,
  role: 'admin' | 'user',
): Promise<Loaded<{ id: string; role: string }>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).role.put({ role });
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira would not change this role.',
      ),
    };
  }

  return { ok: true, value: data };
}

/**
 * Suspend a person or bring them back.
 *
 * The reason is the operator's note: it is recorded with the action and is not
 * shown to the person, who is told only that access is suspended (docs/adr/0035).
 */
export async function setSuspended(
  userId: string,
  suspended: boolean,
  reason?: string,
): Promise<Loaded<{ id: string; suspended: boolean }>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).suspension.put({
    suspended,
    ...(reason === undefined || reason === '' ? {} : { reason }),
  });
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira would not change this person.',
      ),
    };
  }

  return { ok: true, value: data };
}

/** One console session, as the server lists it. The token itself never arrives. */
export interface ConsoleSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function readSessions(userId: string): Promise<Loaded<ConsoleSession[]>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).sessions.get();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        "Kira could not read this person's sessions.",
      ),
    };
  }

  return { ok: true, value: data.sessions };
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<Loaded<{ id: string }>> {
  const { data, error } = await kira.api.admin
    .users({ id: userId })
    .sessions({ sessionId })
    .delete();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not sign that session out.',
      ),
    };
  }

  return { ok: true, value: data };
}

export async function revokeSessions(userId: string): Promise<Loaded<{ id: string }>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).sessions.delete();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not sign this person out everywhere.',
      ),
    };
  }

  return { ok: true, value: data };
}

/** One device Key, as the server lists it. */
export interface DeviceKey {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export async function readKeys(userId: string): Promise<Loaded<DeviceKey[]>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).keys.get();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        "Kira could not read this person's Keys.",
      ),
    };
  }

  return { ok: true, value: data.keys };
}

export async function revokeKey(userId: string, keyId: string): Promise<Loaded<{ id: string }>> {
  const { data, error } = await kira.api.admin.users({ id: userId }).keys({ keyId }).delete();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not revoke that Key.',
      ),
    };
  }

  return { ok: true, value: data };
}
