import { createAuthClient } from 'better-auth/client';
import { adminClient } from 'better-auth/client/plugins';
import { type Loaded, reasonFor } from './result';

/**
 * The console's one door to the server.
 *
 * The address is relative because the console is always one origin with the API:
 * in production the server serves it, and in development Vite proxies `/api` to
 * the server, so no build has to know where Kira is running. Nothing here
 * presents a key — a browser has a session cookie, which the browser attaches
 * itself, and that is the difference between this console and the desktop.
 */
export const auth = createAuthClient({ plugins: [adminClient()] });

/** Who is signed in, in the terms the console draws them. */
export type Who = {
  name: string;
  email: string;
  /** Whether the console will show them anything. The server decides; this chooses a screen. */
  admin: boolean;
};

/**
 * Whether a user row's role admits someone to the console.
 *
 * Kira has one administrator role, so this is the plugin's own comparison with
 * `defaultRoles` spelled out. It is a screen choice, not a gate: every read below
 * is refused by the server for a user who is not an administrator, whatever this
 * answers.
 */
function isAdmin(role: string | null | undefined): boolean {
  return (role ?? '').split(',').includes('admin');
}

/**
 * Who is signed in, or null when nobody is.
 *
 * The client is the library's own, so the session shape is the server's schema
 * rather than a copy of it — `role` is on the user because the server enables the
 * admin plugin, not because Kira declared it.
 */
export async function who(): Promise<Loaded<Who | null>> {
  const { data, error } = await auth.getSession();
  if (error) return { ok: false, message: reasonFor(error, 'Kira could not be reached.') };
  if (!data) return { ok: true, value: null };

  return {
    ok: true,
    value: { name: data.user.name, email: data.user.email, admin: isAdmin(data.user.role) },
  };
}

/**
 * Send the browser to Microsoft and back, returning to the console.
 *
 * It is a journey rather than a call: the browser leaves this page entirely, and
 * what comes back is a session. Where it returns to is this page's own address,
 * so the console is where the browser lands again.
 */
export async function signIn(): Promise<Loaded<true>> {
  const { error } = await auth.signIn.social({
    provider: 'microsoft',
    callbackURL: window.location.href,
  });

  return error
    ? { ok: false, message: reasonFor(error, 'Microsoft sign-in is unavailable.') }
    : { ok: true, value: true };
}

/** Forget this browser, and the session it holds. */
export async function signOut(): Promise<Loaded<true>> {
  const { error } = await auth.signOut();

  return error
    ? { ok: false, message: reasonFor(error, 'Kira could not sign this browser out.') }
    : { ok: true, value: true };
}
