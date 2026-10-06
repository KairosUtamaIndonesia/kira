import { count, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { recordAdminAudit } from './admin-audit';
import { adminGuard } from './admin-guard';
import type { Auth } from './auth';
import type { Database } from './database';
import { REFUSAL, refusal } from './refusals';
import { user } from './schema';

/** How many people hold the admin role. */
async function adminCount(database: Database): Promise<number> {
  const [row] = await database.select({ total: count() }).from(user).where(eq(user.role, 'admin'));

  return Number(row?.total ?? 0);
}

/**
 * The console's changes to a person's authority.
 *
 * The role is the admin plugin's, but the write goes through Kira so the change
 * and its audit row are one act: a role cannot move without a record (docs/adr/0007).
 * The last-administrator guard lives here too, because the plugin has none and a
 * console that can empty its own role list is a console nobody can get back into.
 */
export function createAdminUsers({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .guard({ beforeHandle: adminGuard(auth, 'Only an administrator can change a role.') })
    .put(
      '/api/admin/users/:id/role',
      async ({ params, body, request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }

        const [target] = await database
          .select({ id: user.id, email: user.email, role: user.role })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        // Removing the last administrator would lock the console out of itself,
        // and the out-of-band command is then the only way back (docs/adr/0007).
        if (body.role !== 'admin' && target.role === 'admin' && (await adminCount(database)) <= 1) {
          return status(
            409,
            refusal(
              'LAST_ADMIN',
              'Kira would be left with no administrator. Grant the role to somebody else first.',
            ),
          );
        }

        const context = await auth.$context;
        await context.internalAdapter.updateUser(params.id, { role: body.role });

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: 'role',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
          detail: body.role,
        });

        return { id: params.id, role: body.role };
      },
      {
        body: t.Object({ role: t.Union([t.Literal('admin'), t.Literal('user')]) }),
        response: {
          200: t.Object({ id: t.String(), role: t.String() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
          409: REFUSAL,
        },
        detail: { summary: "Grant or remove a person's admin role" },
      },
    )
    .put(
      '/api/admin/users/:id/suspension',
      async ({ params, body, request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }

        const [target] = await database
          .select({ id: user.id, email: user.email, role: user.role })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        // Suspending the last administrator locks the console out of itself just
        // as removing the role does, so the same guard covers both (docs/adr/0007).
        if (body.suspended && target.role === 'admin' && (await adminCount(database)) <= 1) {
          return status(
            409,
            refusal(
              'LAST_ADMIN',
              'Kira would be left with no administrator. Grant the role to somebody else first.',
            ),
          );
        }

        // The plugin's ban revokes the person's sessions and blocks new sign-ins;
        // the Key is stopped separately, at the shared boundary (docs/adr/0035).
        if (body.suspended) {
          await auth.api.banUser({
            body: {
              userId: params.id,
              ...(body.reason === undefined ? {} : { banReason: body.reason }),
            },
            headers: request.headers,
          });
        } else {
          await auth.api.unbanUser({
            body: { userId: params.id },
            headers: request.headers,
          });
        }

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: body.suspended ? 'suspend' : 'reactivate',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
          // The reason is an operator's note; the suspended person is not shown it.
          ...(body.suspended && body.reason !== undefined ? { detail: body.reason } : {}),
        });

        return { id: params.id, suspended: body.suspended };
      },
      {
        body: t.Object({
          suspended: t.Boolean(),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
        response: {
          200: t.Object({ id: t.String(), suspended: t.Boolean() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
          409: REFUSAL,
        },
        detail: { summary: 'Suspend or reactivate a person' },
      },
    )
    .get(
      '/api/admin/users/:id/sessions',
      async ({ params, status }) => {
        const [target] = await database
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        return { sessions: await sessionsOf(auth, params.id) };
      },
      {
        response: {
          200: t.Object({ sessions: t.Array(SESSION) }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'The sessions signed into the console for a person' },
      },
    )
    .delete(
      '/api/admin/users/:id/sessions/:sessionId',
      async ({ params, request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }

        const [target] = await database
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        const context = await auth.$context;
        const found = (await context.internalAdapter.listSessions(params.id)).find(
          (each) => each.id === params.sessionId,
        );
        if (!found) {
          return status(404, refusal('SESSION_NOT_FOUND', 'That session has already ended.'));
        }

        await context.internalAdapter.deleteSession(found.token);

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: 'revoke-session',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
        });

        return { id: params.sessionId };
      },
      {
        params: t.Object({
          id: t.String({ minLength: 1, maxLength: 512 }),
          sessionId: t.String({ minLength: 1, maxLength: 512 }),
        }),
        response: {
          200: t.Object({ id: t.String() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Sign one console session out' },
      },
    )
    .delete(
      '/api/admin/users/:id/sessions',
      async ({ params, request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }

        const [target] = await database
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        const context = await auth.$context;
        await context.internalAdapter.deleteUserSessions(params.id);

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: 'revoke-sessions',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
        });

        return { id: params.id };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1, maxLength: 512 }) }),
        response: {
          200: t.Object({ id: t.String() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'Sign every console session out' },
      },
    );
}

/** A session as the console draws it. The token itself is never sent. */
const SESSION = t.Object({
  id: t.String(),
  createdAt: t.String(),
  expiresAt: t.String(),
  ipAddress: t.Nullable(t.String()),
  userAgent: t.Nullable(t.String()),
});

/** A person's console sessions, without the secret that would let one be resumed. */
async function sessionsOf(auth: Auth, userId: string) {
  const context = await auth.$context;
  const sessions = await context.internalAdapter.listSessions(userId);

  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  }));
}
