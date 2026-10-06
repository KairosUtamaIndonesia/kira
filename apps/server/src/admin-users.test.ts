import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import { recentAdminAudit } from './admin-audit';
import { closeDatabases, consoleSession, listening, user } from './test-support/server';

/** The person the stand-in Microsoft signs in as. */
const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: '11111111-2222-3333-4444-555555555555',
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

afterAll(closeDatabases);

async function changeRole(
  origin: string,
  cookie: string,
  userId: string,
  role: 'admin' | 'user',
): Promise<Response> {
  return fetch(`${origin}/api/admin/users/${userId}/role`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ role }),
  });
}

describe('changing a role', () => {
  test('an ordinary session is refused', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const cookie = await consoleSession(server.origin);

      const response = await changeRole(server.origin, cookie, grace.id, 'admin');

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('NOT_AN_ADMIN');
    } finally {
      await server.stop();
    }
  });

  test('an administrator grants and removes it, and both are recorded', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);

      const granted = await changeRole(server.origin, cookie, grace.id, 'admin');
      expect(granted.status).toBe(200);
      expect(await granted.json()).toEqual({ id: grace.id, role: 'admin' });

      const removed = await changeRole(server.origin, cookie, grace.id, 'user');
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ id: grace.id, role: 'user' });

      const events = await recentAdminAudit(server.database);
      expect(events.map((event) => event.action)).toEqual(['role', 'role']);
      expect(events[0]).toMatchObject({ targetLabel: 'grace@company.example' });
    } finally {
      await server.stop();
    }
  });

  test('the last administrator cannot take their own role away', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const context = await server.auth.$context;
      const found = await context.internalAdapter.findUserByEmail(ADA.email);

      const response = await changeRole(server.origin, cookie, found!.user.id, 'user');

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('LAST_ADMIN');
    } finally {
      await server.stop();
    }
  });

  test('refuses a person who does not exist', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);

      const response = await changeRole(server.origin, cookie, 'nobody-at-all', 'admin');

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('USER_NOT_FOUND');
    } finally {
      await server.stop();
    }
  });
});
