import { afterAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { grantAdmin } from './admin';
import { closeDatabases, consoleSession, listening } from './test-support/server';

const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: '11111111-2222-3333-4444-555555555555',
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

afterAll(closeDatabases);

describe('the admin console reads Pool health', () => {
  test('requires a signed-in administrator', async () => {
    const server = await listening(ADA, { managementKey: null });
    try {
      const unsigned = await fetch(`${server.origin}/api/admin/pool`);
      expect(unsigned.status).toBe(401);
      const unsignedAudit = await fetch(`${server.origin}/api/admin/pool/audit`);
      expect(unsignedAudit.status).toBe(401);
      const cookie = await consoleSession(server.origin);
      const ordinary = await fetch(`${server.origin}/api/admin/pool`, { headers: { cookie } });
      expect(ordinary.status).toBe(403);
      expect((await ordinary.json()).error.code).toBe('NOT_AN_ADMIN');
      const ordinaryAudit = await fetch(`${server.origin}/api/admin/pool/audit`, { headers: { cookie } });
      expect(ordinaryAudit.status).toBe(403);
    } finally {
      await server.stop();
    }
  });

  test('shows safe credential health without leaking proxy secrets', async () => {
    const proxy = createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer management-test-secret');
      expect(request.url).toBe('/v0/management/auth-files');
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          files: [
            {
              auth_index: 'credential-1',
              name: 'codex-ada.json',
              provider: 'codex',
              email: 'ada@company.example',
              status: 'active',
              status_message: 'upstream returned access_token=must-not-leak',
              disabled: false,
              unavailable: false,
              cooldowns: [{ reason: 'quota', remaining_seconds: 30 }],
              quota: { signals: { 'x-codex-primary-used-percent': '70' } },
              access_token: 'must-not-leak',
              id_token: { secret: 'must-not-leak-either' },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('fake proxy did not bind');
    const server = await listening(ADA, {
      url: `http://127.0.0.1:${address.port}`,
      managementKey: 'management-test-secret',
    });

    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const response = await fetch(`${server.origin}/api/admin/pool`, { headers: { cookie } });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('ada@company.example');
      expect(body).toContain('x-codex-primary-used-percent');
      expect(body).not.toContain('must-not-leak');
      expect(body).not.toContain('access_token');
      expect(JSON.parse(body)).toMatchObject({
        status: 'ready',
        credentials: [{ provider: 'codex', status: 'active', disabled: false }],
      });
      const audit = await fetch(`${server.origin}/api/admin/pool/audit`, { headers: { cookie } });
      expect(audit.status).toBe(200);
      expect(await audit.json()).toEqual({ events: [] });
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test('reports unconfigured management without contacting the proxy', async () => {
    const server = await listening(ADA, { managementKey: null });
    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const response = await fetch(`${server.origin}/api/admin/pool`, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'unconfigured', credentials: [] });
    } finally {
      await server.stop();
    }
  });

  test('stops calling CLIProxyAPI after it rejects the management key', async () => {
    let calls = 0;
    const proxy = createServer((_request, response) => {
      calls += 1;
      response.writeHead(401).end('{"error":"wrong key"}');
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('fake proxy did not bind');
    const server = await listening(ADA, {
      url: `http://127.0.0.1:${address.port}`,
      managementKey: 'management-test-secret',
    });

    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);
      const first = await fetch(`${server.origin}/api/admin/pool`, { headers: { cookie } });
      const second = await fetch(`${server.origin}/api/admin/pool`, { headers: { cookie } });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ status: 'rejected', credentials: [] });
      expect(await second.json()).toEqual({ status: 'rejected', credentials: [] });
      expect(calls).toBe(1);
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
