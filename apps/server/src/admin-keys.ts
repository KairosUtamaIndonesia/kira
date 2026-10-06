import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { recordAdminAudit } from './admin-audit';
import { adminGuard } from './admin-guard';
import type { Auth } from './auth';
import type { Database } from './database';
import { REFUSAL, refusal } from './refusals';
import { apikey, user } from './schema';

/** A device Key as the console draws it. */
const KEY = t.Object({
  id: t.String(),
  name: t.Nullable(t.String()),
  createdAt: t.String(),
  lastUsedAt: t.Nullable(t.String()),
  expiresAt: t.Nullable(t.String()),
});

/**
 * The Keys held for a person, and the way to take one away.
 *
 * Better Auth's api-key endpoints are the caller's own: they cannot list or revoke
 * another person's key, and its verification never reads a key's owner. So this
 * reads and deletes the `apikey` rows directly, which is the same store the plugin
 * writes (docs/adr/0006). No plugin change is needed; the console is the caller
 * that needs the capability, and it is gated by the role.
 */
export function createAdminKeys({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .guard({
      beforeHandle: adminGuard(auth, "Only an administrator can manage a person's Keys."),
    })
    .get(
      '/api/admin/users/:id/keys',
      async ({ params, status }) => {
        const [target] = await database
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, params.id));
        if (!target) return status(404, refusal('USER_NOT_FOUND', 'No such person.'));

        const rows = await database
          .select({
            id: apikey.id,
            name: apikey.name,
            createdAt: apikey.createdAt,
            lastRequest: apikey.lastRequest,
            expiresAt: apikey.expiresAt,
          })
          .from(apikey)
          .where(eq(apikey.referenceId, params.id));

        return {
          keys: rows.map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: row.lastRequest?.toISOString() ?? null,
            expiresAt: row.expiresAt?.toISOString() ?? null,
          })),
        };
      },
      {
        response: {
          200: t.Object({ keys: t.Array(KEY) }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: 'The Keys held for a person' },
      },
    )
    .delete(
      '/api/admin/users/:id/keys/:keyId',
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

        // Scoped to the person as well as the Key, so a stale screen cannot take
        // away a Key that has since been reissued to somebody else.
        const removed = await database
          .delete(apikey)
          .where(and(eq(apikey.id, params.keyId), eq(apikey.referenceId, params.id)))
          .returning({ id: apikey.id });
        if (removed.length === 0) {
          return status(404, refusal('KEY_NOT_FOUND', 'That Key is no longer in the Pool.'));
        }

        await recordAdminAudit(database, {
          actorId: session.user.id,
          actorLabel: session.user.email,
          action: 'revoke-key',
          targetId: params.id,
          targetLabel: target.email,
          outcome: 'succeeded',
          detail: params.keyId,
        });

        return { id: params.keyId };
      },
      {
        params: t.Object({
          id: t.String({ minLength: 1, maxLength: 512 }),
          keyId: t.String({ minLength: 1, maxLength: 512 }),
        }),
        response: {
          200: t.Object({ id: t.String() }),
          401: REFUSAL,
          403: REFUSAL,
          404: REFUSAL,
        },
        detail: { summary: "Revoke one of a person's Keys" },
      },
    );
}
