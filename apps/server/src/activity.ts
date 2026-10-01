/**
 * What the server records when a ticket changes.
 *
 * One row per change, written where the change is written. Kira has no event bus
 * and does not need one for this: the routes that change a ticket are the same
 * places that know what changed (docs/adr/0026). `action` is a fixed word so a
 * reader can filter on it; `details` carries whatever that word needs to be
 * drawn, with names resolved here so the timeline never has to look anyone up.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { ticketActivity } from './schema';

/** The vocabulary a timeline entry can be drawn from. */
export type ActivityAction =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'assignee_changed'
  | 'title_changed'
  | 'body_updated'
  | 'blocker_added'
  | 'blocker_removed'
  | 'pull_request_linked'
  | 'pull_request_merged'
  | 'outcome_recorded';

export interface ActivityEntry {
  ticketId: string;
  /** The person the change is from, or null for one the server made on its own. */
  actorId: string | null;
  /** member for a person's write, kira for an agent's, system for the server's own. */
  actorKind: 'member' | 'kira' | 'system';
  action: ActivityAction;
  details?: Record<string, unknown>;
}

/** Record changes, in the order they are given. A change with no actor is the server's own. */
export async function recordActivity(
  database: Database,
  entries: readonly ActivityEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  await database.insert(ticketActivity).values(
    entries.map((entry) => ({
      id: randomUUID(),
      ticketId: entry.ticketId,
      actorId: entry.actorId,
      actorKind: entry.actorKind,
      action: entry.action,
      details: entry.details ?? {},
    })),
  );
}
