import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import { recentAdminAudit } from './admin-audit';
import {
  bearer,
  closeDatabases,
  consoleSession,
  issue,
  listening,
  send,
  user,
} from './test-support/server';

/** The person the stand-in Microsoft signs in as. */
const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: '11111111-2222-3333-4444-555555555555',
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

afterAll(closeDatabases);

type Server = Awaited<ReturnType<typeof listening>>;

async function signedInAdmin(server: Server): Promise<string> {
  const cookie = await consoleSession(server.origin);
  await grantAdmin(server.auth, ADA.email);

  return cookie;
}

describe("a person's Keys", () => {
  test('an ordinary session is refused', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const cookie = await consoleSession(server.origin);

      const response = await fetch(`${server.origin}/api/admin/users/${grace.id}/keys`, {
        headers: { cookie },
      });

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('NOT_AN_ADMIN');
    } finally {
      await server.stop();
    }
  });

  test('an administrator lists them and revokes one', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await signedInAdmin(server);
      const grace = await user(server.auth, 'grace@company.example');
      const key = await issue(server.auth, grace.id, 'workstation');

      const listed = await fetch(`${server.origin}/api/admin/users/${grace.id}/keys`, {
        headers: { cookie },
      });
      expect(listed.status).toBe(200);
      const { keys } = (await listed.json()) as {
        keys: { id: string; name: string | null; createdAt: string; expiresAt: string | null }[];
      };
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({ id: key.id, name: 'workstation' });
      expect(typeof keys[0]!.createdAt).toBe('string');
      expect(typeof keys[0]!.expiresAt).toBe('string');

      const revoked = await fetch(`${server.origin}/api/admin/users/${grace.id}/keys/${key.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(revoked.status).toBe(200);

      const refused = await send(server.app, '/api/me', { headers: bearer(key.key) });
      expect(refused.status).toBe(401);
      expect((await refused.json()).error.code).toBe('INVALID_API_KEY');

      const events = await recentAdminAudit(server.database);
      expect(events.find((event) => event.action === 'revoke-key')).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  test('will not revoke a Key through the wrong person', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await signedInAdmin(server);
      const grace = await user(server.auth, 'grace@company.example');
      const maya = await user(server.auth, 'maya@company.example');
      const key = await issue(server.auth, grace.id, 'workstation');

      const response = await fetch(`${server.origin}/api/admin/users/${maya.id}/keys/${key.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('KEY_NOT_FOUND');

      const kept = await send(server.app, '/api/me', { headers: bearer(key.key) });
      expect(kept.status).toBe(200);
    } finally {
      await server.stop();
    }
  });
});
