import { desc } from 'drizzle-orm';
import type { Database } from './database';
import { poolAudit } from './schema';

export type PoolAuditAction = 'login' | 'enable' | 'disable' | 'refresh' | 'delete';

/** Write safe facts about an attempt; sensitive upstream payloads have no field here. */
export async function recordPoolAudit(
  database: Database,
  event: {
    actorId: string | null;
    actorLabel: string;
    action: PoolAuditAction;
    provider: string | null;
    credentialLabel: string | null;
    outcome: 'succeeded' | 'failed';
    detail?: string;
  },
): Promise<void> {
  await database.insert(poolAudit).values({
    id: crypto.randomUUID(),
    ...event,
  });
}

/** The newest safe events for the admin console. */
export async function recentPoolAudit(database: Database) {
  const rows = await database
    .select({
      id: poolAudit.id,
      actorLabel: poolAudit.actorLabel,
      action: poolAudit.action,
      provider: poolAudit.provider,
      credentialLabel: poolAudit.credentialLabel,
      outcome: poolAudit.outcome,
      detail: poolAudit.detail,
      createdAt: poolAudit.createdAt,
    })
    .from(poolAudit)
    .orderBy(desc(poolAudit.createdAt), desc(poolAudit.id))
    .limit(100);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
