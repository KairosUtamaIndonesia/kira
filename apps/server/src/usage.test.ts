import { afterAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { boot, closeDatabases, user } from './test-support/server';
import { recordUsage, type UsageRecord, usageFor } from './usage';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

type Person = 'ada' | 'grace';

const ADDRESSES: Record<Person, string> = {
  ada: 'ada@company.example',
  grace: 'grace@company.example',
};

/** A request as it is written down, before anyone has been given an id. */
type Written = Omit<UsageRecord, 'userId'> & { to: Person };

describe('the usage ledger', () => {
  /**
   * What goes in, and what each person should read back out.
   *
   * One function over a table rather than a test apiece, because these differ
   * only in their rows: writing a request down and reading a person's own back
   * is one behaviour, and what varies is which requests come back for whom.
   */
  const ledgers: {
    name: string;
    written: Written[];
    reads: { as: Person; expected: Omit<UsageRecord, 'userId'>[] }[];
  }[] = [
    {
      name: 'a completed request is remembered with everything it used',
      written: [
        {
          to: 'ada',
          ...used(1200, 340, { cacheReadTokens: 900, cacheWriteTokens: 100 }),
          at: '2026-09-18T14:00:00.000Z',
        },
      ],
      reads: [
        {
          as: 'ada',
          expected: [
            {
              ...used(1200, 340, { cacheReadTokens: 900, cacheWriteTokens: 100 }),
              at: '2026-09-18T14:00:00.000Z',
            },
          ],
        },
      ],
    },
    {
      name: 'each person reads back their own requests, and a request that used nothing is still one',
      written: [
        { to: 'ada', ...used(10, 4), at: '2026-09-18T10:00:00.000Z' },
        {
          to: 'grace',
          ...used(70, 0, { model: 'claude-sonnet-5' }),
          at: '2026-09-18T11:00:00.000Z',
        },
        // Nothing counted at all: still a fact about a request that happened, and
        // the upstream's own all-zero figure must not be able to erase it.
        { to: 'ada', ...used(0, 0), at: '2026-09-18T12:00:00.000Z' },
      ],
      reads: [
        {
          as: 'ada',
          expected: [
            { ...used(10, 4), at: '2026-09-18T10:00:00.000Z' },
            { ...used(0, 0), at: '2026-09-18T12:00:00.000Z' },
          ],
        },
        {
          as: 'grace',
          expected: [
            { ...used(70, 0, { model: 'claude-sonnet-5' }), at: '2026-09-18T11:00:00.000Z' },
          ],
        },
      ],
    },
  ];

  test.each(ledgers)('$name', async ({ written, reads }) => {
    const { auth, database } = await boot();
    const people = {
      ada: await user(auth, ADDRESSES.ada),
      grace: await user(auth, ADDRESSES.grace),
    };

    for (const { to, ...record } of written) {
      await recordUsage(database, { ...record, userId: people[to].id });
    }

    for (const read of reads) {
      const { id } = people[read.as];

      expect(await usageFor(database, id)).toEqual(
        read.expected.map((row) => ({ ...row, userId: id })),
      );
    }
  });

  test('a usage row belongs to a person who exists, and goes when they do', async () => {
    const { auth, database } = await boot();
    const ada = await user(auth);

    // The reference is what one database buys (docs/adr/0005-allowances.md), so
    // it has to be enforced rather than merely written down.
    const refusal = await recordUsage(database, {
      userId: 'nobody-at-all',
      ...used(12, 3),
      at: '2026-09-18T14:00:00.000Z',
    })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(refusal).not.toBeNull();
    expect(databaseSaid(refusal)).toMatch(/foreign key/i);

    await recordUsage(database, {
      userId: ada.id,
      ...used(12, 3),
      at: '2026-09-18T14:00:00.000Z',
    });
    expect(await usageFor(database, ada.id)).toHaveLength(1);

    await database.execute(sql`DELETE FROM "user" WHERE id = ${ada.id}`);

    expect(await usageFor(database, ada.id)).toEqual([]);
  });
});

/**
 * What the database itself said, under whatever the query builder wrapped around it.
 *
 * The refusal has to be the database's rather than Kira's — that is the whole
 * claim of the reference — but the words it used arrive wrapped in the query
 * builder's own message, so the reason has to be read from the bottom of the chain.
 */
function databaseSaid(error: unknown): string {
  let deepest: unknown = error;

  while (deepest instanceof Error && deepest.cause) deepest = deepest.cause;

  return deepest instanceof Error ? deepest.message : String(deepest);
}

/** A request that used these tokens, and nothing else unless it is said so. */
function used(
  inputTokens: number,
  outputTokens: number,
  overrides: Partial<Omit<UsageRecord, 'userId' | 'inputTokens' | 'outputTokens'>> = {},
): Omit<UsageRecord, 'userId'> {
  return {
    model: 'gpt-5.6-luna',
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outcome: 'ok',
    at: '2026-09-18T14:00:00.000Z',
    ...overrides,
  };
}
