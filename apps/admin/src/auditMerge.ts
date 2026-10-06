import type { AdminAuditEvent } from './api/audit';
import type { PoolAuditEvent } from './api/pool';

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

/**
 * Admin actions and Pool changes as one list, newest first.
 *
 * Two tables, because they are about different things — a person's access and a
 * provider's Credential — but one question for an operator: who did what. A pure
 * function so the merge and the ordering are testable without a server or a DOM.
 */
export function mergeAuditEvents(
  admin: readonly AdminAuditEvent[],
  pool: readonly PoolAuditEvent[],
): AuditEvent[] {
  return [
    ...admin.map((event) => ({
      id: `admin:${event.id}`,
      at: event.createdAt,
      actor: event.actorLabel,
      action: event.action,
      target: event.targetLabel,
      outcome: event.outcome,
      detail: event.detail,
    })),
    ...pool.map((event) => ({
      id: `pool:${event.id}`,
      at: event.createdAt,
      actor: event.actorLabel,
      action: event.action,
      target: event.credentialLabel ?? event.provider,
      outcome: event.outcome,
      detail: event.detail,
    })),
  ].sort((left, right) => right.at.localeCompare(left.at));
}
