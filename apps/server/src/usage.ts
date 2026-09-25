import { eq } from 'drizzle-orm';
import type { Database } from './database';
import { usage } from './schema';

/**
 * What one completed request used, as the ledger keeps it.
 *
 * Raw facts rather than counters (docs/adr/0005-allowances.md): a month-to-date
 * total, a window or a future cost estimate is a query over these rows, so
 * deciding later which window matters never means migrating a number that was
 * rolled up too early. Cache reads and writes are kept apart from input and
 * output because upstream bills them differently.
 */
export interface UsageRecord {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * Why a request was turned away, in the words of the code the caller was
   * answered with. Absent for a request that was sent.
   */
  reason?: string;
  /**
   * How the request ended: `ok` for a reply that arrived whole, `failed` for one
   * that stopped part-way having already spent tokens, and `refused` for a request
   * turned away before anything was sent — by the allowance, or by the pool. A
   * refusal spends nothing and is a row like any other, which is what lets an
   * operator see who is being turned away and why.
   *
   * Text rather than a closed set, because that is all a column can promise and
   * this vocabulary is as old as the route that writes it; the three words live in
   * `OUTCOME`, so a query that branches on one and the writer that produces it
   * cannot drift apart.
   */
  outcome: string;
  /** When the request completed, as an ISO 8601 instant. */
  at: string;
}

/**
 * The words Kira writes in a ledger row's `outcome`.
 *
 * One home for them, because a query branching on a word and the writer producing
 * it must not be able to disagree. A type would be tighter, but a read of a text
 * column yields a string whatever is declared, so that promise would be one the
 * database does not keep.
 */
export const OUTCOME = {
  /** A reply that arrived whole. */
  ok: 'ok',
  /** One that stopped part-way, having already spent tokens. */
  failed: 'failed',
  /** A request turned away before anything was sent. It spent nothing. */
  refused: 'refused',
} as const;

/**
 * Write down what one completed request used.
 *
 * There is nothing to migrate here any more: the table is in `src/schema.ts`
 * with everything else, and one set of statements creates the whole database. A
 * row for somebody who does not exist is refused by the database rather than by
 * a check here — the reference to `user` is what makes a usage row unable to
 * outlive the person it is about (docs/adr/0005-allowances.md).
 */
export async function recordUsage(database: Database, record: UsageRecord): Promise<void> {
  await database.insert(usage).values({ ...record, at: new Date(record.at) });
}

/** Everything one person has used, in the order the requests completed. */
export async function usageFor(database: Database, userId: string): Promise<UsageRecord[]> {
  // The columns are named once here, which is also what keeps the row's `id` —
  // needed to order by, not wanted in the answer — out of the way.
  const rows = await database
    .select({
      userId: usage.userId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reason: usage.reason,
      outcome: usage.outcome,
      at: usage.at,
    })
    .from(usage)
    .where(eq(usage.userId, userId))
    .orderBy(usage.id);

  return rows.map((row) => ({
    ...row,
    // A column holding no reason reads as no reason, rather than as a null a
    // caller has to think about.
    reason: row.reason ?? undefined,
    // An instant is stored as one; a record says it the way the rest of Kira
    // says it, so a caller never has to think about the column's type.
    at: row.at.toISOString(),
  }));
}
