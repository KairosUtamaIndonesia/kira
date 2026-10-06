import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import { recentAdminAudit } from './admin-audit';
import {
  closeDatabases,
  consoleSession,
  cookieHeader,
  listening,
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

describe('impersonation', () => {
  test('an administrator acts as somebody, and both ends are recorded', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const context = await server.auth.$context;
      const ada = await context.internalAdapter.findUserByEmail(ADA.email);

      const started = await fetch(`${server.origin}/api/admin/users/${grace.id}/impersonate`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(started.status).toBe(200);

      // The plugin's cookie makes this browser grace, marked with who sent it.
      const acting = cookieHeader(started);
      const asGrace = await server.auth.api.getSession({ headers: { cookie: acting } });
      expect(asGrace?.user.email).toBe('grace@company.example');
      expect((asGrace?.session as { impersonatedBy?: string } | undefined)?.impersonatedBy).toBe(
        ada!.user.id,
      );

      const stopped = await fetch(`${server.origin}/api/admin/impersonate/stop`, {
        method: 'POST',
        headers: { cookie: acting },
      });
      expect(stopped.status).toBe(200);
      const restored = await server.auth.api.getSession({
        headers: { cookie: cookieHeader(stopped) },
      });
      expect(restored?.user.email).toBe('ada@company.example');

      const actions = (await recentAdminAudit(server.database)).map((event) => event.action);
      expect(actions).toContain('impersonate');
      expect(actions).toContain('stop-impersonating');
    } finally {
      await server.stop();
    }
  });

  test('an ordinary session cannot impersonate', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const cookie = await consoleSession(server.origin);

      const response = await fetch(`${server.origin}/api/admin/users/${grace.id}/impersonate`, {
        method: 'POST',
        headers: { cookie },
      });

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('NOT_AN_ADMIN');
    } finally {
      await server.stop();
    }
  });
});
