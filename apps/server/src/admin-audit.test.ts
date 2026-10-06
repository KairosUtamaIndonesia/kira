import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import { recordAdminAudit } from './admin-audit';
import { closeDatabases, consoleSession, listening, user } from './test-support/server';

/** The person the stand-in Microsoft signs in as. */
const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: '11111111-2222-3333-4444-555555555555',
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

afterAll(closeDatabases);

describe("the console's audit", () => {
  test('refuses a request with no session', async () => {
    const server = await listening(ADA);
    try {
      const response = await fetch(`${server.origin}/api/admin/audit`);

      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe('NOT_SIGNED_IN');
    } finally {
      await server.stop();
    }
  });

  test('refuses a session that is not an administrator', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await consoleSession(server.origin);

      const response = await fetch(`${server.origin}/api/admin/audit`, { headers: { cookie } });

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('NOT_AN_ADMIN');
    } finally {
      await server.stop();
    }
  });

  test('an administrator reads what has been done, newest first', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const maya = await user(server.auth, 'maya@company.example');
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);

      await recordAdminAudit(server.database, {
        actorId: grace.id,
        actorLabel: grace.email,
        action: 'role',
        targetId: maya.id,
        targetLabel: maya.email,
        outcome: 'succeeded',
        detail: 'admin',
      });

      const response = await fetch(`${server.origin}/api/admin/audit`, { headers: { cookie } });

      expect(response.status).toBe(200);
      const { events } = (await response.json()) as { events: unknown[] };
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorLabel: grace.email,
        action: 'role',
        targetLabel: maya.email,
        outcome: 'succeeded',
        detail: 'admin',
      });
    } finally {
      await server.stop();
    }
  });
});
