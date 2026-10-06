import { treaty } from '@elysiajs/eden';
import type { App } from '@kira/server/contract';
import { readPoolAudit } from './pool';
import { type Loaded, reasonFor } from './result';

const kira = treaty<App>(window.location.origin);

/** One action an administrator took, as the server records it. */
export interface AdminAuditEvent {
  id: string;
  actorLabel: string;
  action: string;
  targetLabel: string | null;
  outcome: string;
  detail: string | null;
  createdAt: string;
}

/** One event as the Audit screen draws it, whatever its source. */
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  outcome: string;
  detail: string | null;
}

export async function readAdminAudit(): Promise<Loaded<AdminAuditEvent[]>> {
  const { data, error } = await kira.api.admin.audit.get();
  if (error) {
    return {
      ok: false,
      message: reasonFor(
        error.value as { message?: string } | null,
        'Kira could not read the audit.',
      ),
    };
  }

  return { ok: true, value: data.events };
}

/**
 * Admin actions and Pool changes as one list, newest first.
 *
 * Two tables, because they are about different things — a person's access and a
 * provider's Credential — but one question for an operator: who did what. The
 * merge is here rather than on the server so each route stays about its own table.
 */
export async function readAudit(): Promise<Loaded<AuditEvent[]>> {
  const [admin, pool] = await Promise.all([readAdminAudit(), readPoolAudit()]);
  if (!admin.ok) return { ok: false, message: admin.message };
  if (!pool.ok) return { ok: false, message: pool.message };

  const events: AuditEvent[] = [
    ...admin.value.map((event) => ({
      id: `admin:${event.id}`,
      at: event.createdAt,
      actor: event.actorLabel,
      action: event.action,
      target: event.targetLabel,
      outcome: event.outcome,
      detail: event.detail,
    })),
    ...pool.value.map((event) => ({
      id: `pool:${event.id}`,
      at: event.createdAt,
      actor: event.actorLabel,
      action: event.action,
      target: event.credentialLabel ?? event.provider,
      outcome: event.outcome,
      detail: event.detail,
    })),
  ].sort((left, right) => right.at.localeCompare(left.at));

  return { ok: true, value: events };
}
