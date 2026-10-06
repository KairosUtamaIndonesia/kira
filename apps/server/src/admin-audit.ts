import { desc } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { Auth } from './auth';
import type { Database } from './database';
import { REFUSAL, refusal } from './refusals';
import { adminAudit } from './schema';

/** The words an administrator's own actions are recorded under. */
export type AdminAuditAction =
  | 'role'
  | 'suspend'
  | 'reactivate'
  | 'revoke-session'
  | 'revoke-sessions'
  | 'revoke-key'
  | 'allowance'
  | 'default-allowance'
  | 'impersonate'
  | 'stop-impersonating';

/** One action an administrator took on somebody else's access. */
export interface AdminAuditEvent {
  actorId: string | null;
  actorLabel: string;
  action: AdminAuditAction;
  targetId: string | null;
  targetLabel: string | null;
  outcome: 'succeeded' | 'failed';
  detail?: string;
}

/**
 * Write one append-only fact about a change to somebody's access.
 *
 * Called by the route that makes the change, where the change is made, so an
 * action cannot happen without a record (docs/adr/0007). The Pool keeps its own
 * audit for the same reason; the two are read together on the console's Audit
 * screen.
 */
export async function recordAdminAudit(database: Database, event: AdminAuditEvent): Promise<void> {
  await database.insert(adminAudit).values({
    id: crypto.randomUUID(),
    actorId: event.actorId,
    actorLabel: event.actorLabel,
    action: event.action,
    targetId: event.targetId,
    targetLabel: event.targetLabel,
    outcome: event.outcome,
    detail: event.detail ?? null,
  });
}

/** The newest events, for the console's Audit screen. */
export async function recentAdminAudit(database: Database) {
  const rows = await database
    .select()
    .from(adminAudit)
    .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    actorLabel: row.actorLabel,
    action: row.action,
    targetLabel: row.targetLabel,
    outcome: row.outcome,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * The console's read of what administrators have done.
 *
 * Only the read is here: each action's own route records its fact where it makes
 * the change. This is the console's surface, so it is gated by the role the way
 * every other `/api/admin/*` route is (docs/adr/0007).
 */
export function createAdminAudit({ auth, database }: { auth: Auth; database: Database }) {
  return new Elysia()
    .guard({
      beforeHandle: async ({ request, status }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session === null) {
          return status(
            401,
            refusal('NOT_SIGNED_IN', "This route is the console's; sign in to the console."),
          );
        }
        if ((session.user as { role?: string | null }).role !== 'admin') {
          return status(403, refusal('NOT_AN_ADMIN', 'Only an administrator can read the audit.'));
        }
      },
    })
    .get('/api/admin/audit', async () => ({ events: await recentAdminAudit(database) }), {
      response: {
        200: t.Object({
          events: t.Array(
            t.Object({
              id: t.String(),
              actorLabel: t.String(),
              action: t.String(),
              targetLabel: t.Nullable(t.String()),
              outcome: t.String(),
              detail: t.Nullable(t.String()),
              createdAt: t.String(),
            }),
          ),
        }),
        401: REFUSAL,
        403: REFUSAL,
      },
      detail: { summary: "What administrators have done to people's access" },
    });
}
