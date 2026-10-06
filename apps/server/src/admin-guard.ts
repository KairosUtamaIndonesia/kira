import type { Context } from 'elysia';
import type { Auth } from './auth';
import { refusal } from './refusals';

/**
 * The console's own door: a signed-in session carrying the admin role.
 *
 * Every `/api/admin/*` route asks the same question, and asking it in one place is
 * what keeps the answer from drifting between them. The role is the admin plugin's
 * own, written by `grantAdmin` out of band (docs/adr/0007).
 */
export function adminGuard(auth: Auth, notAnAdmin: string) {
  return async ({ request, status }: Pick<Context, 'request' | 'status'>) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session === null) {
      return status(
        401,
        refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
      );
    }

    if ((session.user as { role?: string | null }).role !== 'admin') {
      return status(403, refusal('NOT_AN_ADMIN', notAnAdmin));
    }
  };
}
