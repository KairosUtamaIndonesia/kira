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

describe('suspending a person', () => {
  async function setSuspended(
    origin: string,
    cookie: string,
    userId: string,
    suspended: boolean,
    reason?: string,
  ): Promise<Response> {
    return fetch(`${origin}/api/admin/users/${userId}/suspension`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ suspended, ...(reason === undefined ? {} : { reason }) }),
    });
  }

  test('cuts off their Key and records the reason; reactivating restores it', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const key = await issue(server.auth, grace.id, 'workstation');
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);

      const suspended = await setSuspended(
        server.origin,
        cookie,
        grace.id,
        true,
        'left the company',
      );
      expect(suspended.status).toBe(200);
      expect(await suspended.json()).toEqual({ id: grace.id, suspended: true });

      const refused = await send(server.app, '/api/me', { headers: bearer(key.key) });
      expect(refused.status).toBe(401);
      expect((await refused.json()).error.code).toBe('USER_SUSPENDED');

      const reactivated = await setSuspended(server.origin, cookie, grace.id, false);
      expect(reactivated.status).toBe(200);

      const restored = await send(server.app, '/api/me', { headers: bearer(key.key) });
      expect(restored.status).toBe(200);

      const events = await recentAdminAudit(server.database);
      expect(events.find((event) => event.action === 'suspend')).toMatchObject({
        detail: 'left the company',
      });
      expect(events.find((event) => event.action === 'reactivate')).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  test('the last administrator cannot be suspended', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const context = await server.auth.$context;
      const found = await context.internalAdapter.findUserByEmail(ADA.email);

      const response = await setSuspended(server.origin, cookie, found!.user.id, true);

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('LAST_ADMIN');
    } finally {
      await server.stop();
    }
  });
});

describe("a person's sessions", () => {
  async function signedInAdmin(server: Awaited<ReturnType<typeof listening>>) {
    const cookie = await consoleSession(server.origin);
    await grantAdmin(server.auth, ADA.email);
    const context = await server.auth.$context;
    const found = await context.internalAdapter.findUserByEmail(ADA.email);

    return { cookie, id: found!.user.id };
  }

  test('an administrator lists them and signs one out', async () => {
    const server = await listening(ADA);
    try {
      const { cookie, id } = await signedInAdmin(server);

      const listed = await fetch(`${server.origin}/api/admin/users/${id}/sessions`, {
        headers: { cookie },
      });
      expect(listed.status).toBe(200);
      const { sessions } = (await listed.json()) as { sessions: { id: string }[] };
      expect(sessions).toHaveLength(1);

      const revoked = await fetch(
        `${server.origin}/api/admin/users/${id}/sessions/${sessions[0]!.id}`,
        { method: 'DELETE', headers: { cookie } },
      );
      expect(revoked.status).toBe(200);

      // The session the cookie carried is the one just taken away.
      const after = await fetch(`${server.origin}/api/admin/users/${id}/sessions`, {
        headers: { cookie },
      });
      expect(after.status).toBe(401);

      const events = await recentAdminAudit(server.database);
      expect(events.find((event) => event.action === 'revoke-session')).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  test('an administrator signs them all out', async () => {
    const server = await listening(ADA);
    try {
      const { cookie, id } = await signedInAdmin(server);

      const response = await fetch(`${server.origin}/api/admin/users/${id}/sessions`, {
        method: 'DELETE',
        headers: { cookie },
      });

      expect(response.status).toBe(200);
      const events = await recentAdminAudit(server.database);
      expect(events.find((event) => event.action === 'revoke-sessions')).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  test('refuses a session that has already ended', async () => {
    const server = await listening(ADA);
    try {
      const { cookie, id } = await signedInAdmin(server);

      const response = await fetch(`${server.origin}/api/admin/users/${id}/sessions/nope`, {
        method: 'DELETE',
        headers: { cookie },
      });

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('SESSION_NOT_FOUND');
    } finally {
      await server.stop();
    }
  });
});
