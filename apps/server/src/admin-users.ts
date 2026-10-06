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
    );
}
