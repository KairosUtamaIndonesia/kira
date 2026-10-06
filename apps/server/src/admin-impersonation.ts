import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { recordAdminAudit } from './admin-audit';
import type { Auth } from './auth';
import type { Database } from './database';
import { REFUSAL, refusal } from './refusals';
import { user } from './schema';

/**
 * Acting as somebody else, and coming back.
 *
 * Better Auth owns the mechanics — impersonate mints a session for the target and
 * marks it, stop returns the administrator's own session. Kira wraps both so the
 * start and the end are written to the audit where they happen, which is the whole
 * reason impersonation is acceptable: a session that ran as somebody else is
 * legible afterwards (docs/adr/0007). The plugin's `set-cookie` is passed through
 * untouched, because that cookie is what makes the browser the other person.
 */
export function createAdminImpersonation({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .post(
      '/api/admin/users/:id/impersonate',
      async ({ params, request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }
        if ((session.user as { role?: string | null }).role !== 'admin') {
          return status(403, refusal('NOT_AN_ADMIN', 'Only an administrator can impersonate.'));
        }

        const [target] = await database
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        const result = await auth.api.impersonateUser({
          body: { userId: params.id },
          headers: request.headers,
          returnHeaders: true,
        });

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: 'impersonate',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
        });

        return withCookies(result.headers, { id: params.id });
      },
      {
        params: t.Object({ id: t.String({ minLength: 1, maxLength: 512 }) }),
        detail: { summary: 'Act as a person in the console' },
      },
    )
    .post(
      '/api/admin/impersonate/stop',
      async ({ request, status }) => {
        const acting = await auth.api.getSession({ headers: request.headers });
        if (acting === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }

        const adminId =
          (acting.session as { impersonatedBy?: string | null }).impersonatedBy ?? null;
        const result = await auth.api.stopImpersonating({
          headers: request.headers,
          returnHeaders: true,
        });

        // The session is the administrator's again now, so the record is written
        // from what was read before the stop: the person who was being acted as.
        if (adminId !== null) {
          const context = await auth.$context;
          const admin = await context.internalAdapter.findUserById(adminId);
          await recordAdminAudit(database, {
            actorId: adminId,
            actorLabel: admin?.email ?? 'Kira admin',
            action: 'stop-impersonating',
            targetId: acting.user.id,
            targetLabel: acting.user.email,
            outcome: 'succeeded',
          });
        }

        return withCookies(result.headers, { stopped: true });
      },
      { detail: { summary: 'Stop acting as a person' } },
    );
}

/** The plugin's cookie reaches the browser; the body is Kira's own small answer. */
function withCookies(headers: Headers, body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie);

  return response;
}
