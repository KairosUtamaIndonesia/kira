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
      const ordinaryAudit = await fetch(`${server.origin}/api/admin/pool/audit`, {
        headers: { cookie },
      });
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

describe('provider login through the admin console', () => {
  test('relays a pasted localhost callback and polls the proxy-owned state', async () => {
    const received: {
      method: string;
      url: string;
      authorization: string | undefined;
      body: string;
    }[] = [];
    let polls = 0;
    const proxy = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v0/management/codex-auth-url') {
        response.end(
          JSON.stringify({
            status: 'ok',
            url: 'https://provider.example/authorize',
            state: 'pending-state',
          }),
        );
      } else if (request.url === '/v0/management/anthropic-auth-url') {
        response.end(
          JSON.stringify({
            status: 'ok',
            url: 'https://provider.example/claude',
            state: 'claude-state',
          }),
        );
      } else if (request.url === '/v0/management/oauth-callback' && request.method === 'POST') {
        response.end('{"status":"ok"}');
      } else if (request.url === '/v0/management/get-auth-status?state=pending-state') {
        polls += 1;
        response.end(JSON.stringify(polls === 1 ? { status: 'wait' } : { status: 'ok' }));
      } else if (
        request.url === '/v0/management/oauth-session?state=claude-state' &&
        request.method === 'DELETE'
      ) {
        response.end('{"status":"ok","cancelled":true}');
      } else {
        response.writeHead(404).end('{}');
      }
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
      const headers = { cookie, 'content-type': 'application/json' };

      const started = await fetch(`${server.origin}/api/admin/pool/oauth`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'codex' }),
      });
      expect(await started.json()).toEqual({
        status: 'pending',
        provider: 'codex',
        url: 'https://provider.example/authorize',
        state: 'pending-state',
      });

      const callbackUrl =
        'http://localhost:1455/auth/callback?code=one-time-code&state=pending-state';
      const callback = await fetch(`${server.origin}/api/admin/pool/oauth/callback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'codex', redirectUrl: callbackUrl }),
      });
      expect(await callback.json()).toEqual({ status: 'accepted' });

      const pending = await fetch(
        `${server.origin}/api/admin/pool/oauth/status?state=pending-state`,
        { headers: { cookie } },
      );
      expect(await pending.json()).toEqual({ status: 'pending' });
      const complete = await fetch(
        `${server.origin}/api/admin/pool/oauth/status?state=pending-state`,
        { headers: { cookie } },
      );
      expect(await complete.json()).toEqual({ status: 'succeeded' });

      const second = await fetch(`${server.origin}/api/admin/pool/oauth`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'claude' }),
      });
      expect((await second.json()).state).toBe('claude-state');
      const cancelled = await fetch(`${server.origin}/api/admin/pool/oauth?state=claude-state`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(await cancelled.json()).toEqual({ status: 'cancelled' });

      const callbackRequest = received.find(
        (request) => request.url === '/v0/management/oauth-callback',
      );
      expect(callbackRequest?.authorization).toBe('Bearer management-test-secret');
      expect(JSON.parse(callbackRequest?.body ?? '{}')).toEqual({
        provider: 'codex',
        redirect_url: callbackUrl,
      });
      expect(
        received
          .filter((request) => request.url.includes('auth-url'))
          .every((request) => request.authorization === 'Bearer management-test-secret'),
      ).toBe(true);

      const audit = await fetch(`${server.origin}/api/admin/pool/audit`, { headers: { cookie } });
      const auditText = await audit.text();
      expect(auditText).toContain('codex');
      expect(auditText).not.toContain(callbackUrl);
      expect(auditText).not.toContain('one-time-code');
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test('refuses callback URLs that do not come from a localhost provider redirect', async () => {
    const proxy = createServer((_request, response) => response.writeHead(500).end());
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
      const response = await fetch(`${server.origin}/api/admin/pool/oauth/callback`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'codex',
          redirectUrl: 'https://attacker.example/callback?code=secret&state=x',
        }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_CALLBACK');
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('shared Credential actions', () => {
  test('enables, disables, refreshes and deletes a credential and audits each attempt safely', async () => {
    const requests: { method: string; url: string; body: string }[] = [];
    const proxy = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: request.method ?? '', url: request.url ?? '', body });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url === '/v0/management/auth-files') {
        response.end(
          JSON.stringify({
            files: [
              {
                auth_index: 'credential-1',
                name: 'codex-ada.json',
                provider: 'codex',
                email: 'ada@company.example',
                status: 'active',
                disabled: false,
              },
            ],
          }),
        );
      } else if (request.method === 'PATCH' && request.url === '/v0/management/auth-files/status') {
        response.end('{"status":"ok"}');
      } else if (request.method === 'POST' && request.url === '/v0/management/auth-files/refresh') {
        response.end('{"status":"ok"}');
      } else if (
        request.method === 'DELETE' &&
        request.url === '/v0/management/auth-files' &&
        JSON.parse(body).name === 'codex-ada.json'
      ) {
        response.end('{"status":"ok"}');
      } else {
        response.writeHead(404).end('{}');
      }
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
      const headers = { cookie, 'content-type': 'application/json' };
      const disable = await fetch(
        `${server.origin}/api/admin/pool/credentials/credential-1/status`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ disabled: true }),
        },
      );
      expect(await disable.json()).toEqual({ status: 'succeeded' });
      const enable = await fetch(
        `${server.origin}/api/admin/pool/credentials/credential-1/status`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ disabled: false }),
        },
      );
      expect(await enable.json()).toEqual({ status: 'succeeded' });
      const refresh = await fetch(
        `${server.origin}/api/admin/pool/credentials/credential-1/refresh`,
        { method: 'POST', headers },
      );
      expect(await refresh.json()).toEqual({ status: 'succeeded' });
      const deleted = await fetch(`${server.origin}/api/admin/pool/credentials/credential-1`, {
        method: 'DELETE',
        headers,
      });
      expect(await deleted.json()).toEqual({ status: 'succeeded' });

      expect(
        requests.filter((request) => request.method !== 'GET').map((request) => request.method),
      ).toEqual(['PATCH', 'PATCH', 'POST', 'DELETE']);
      expect(
        JSON.parse(
          requests.find(
            (request) => request.method === 'PATCH' && JSON.parse(request.body).disabled === false,
          )?.body ?? '{}',
        ),
      ).toMatchObject({ disabled: false, auth_index: 'credential-1' });
      expect(
        JSON.parse(requests.find((request) => request.method === 'POST')?.body ?? '{}'),
      ).toMatchObject({ auth_index: 'credential-1' });

      const audit = await fetch(`${server.origin}/api/admin/pool/audit`, { headers: { cookie } });
      const events = (await audit.json()).events;
      expect(events).toHaveLength(4);
      expect(events.map((event: { action: string }) => event.action).sort()).toEqual([
        'delete',
        'disable',
        'enable',
        'refresh',
      ]);
      expect(
        events.every(
          (event: { outcome: string; credentialLabel: string; provider: string }) =>
            event.outcome === 'succeeded' &&
            event.credentialLabel === 'ada@company.example' &&
            event.provider === 'codex',
        ),
      ).toBe(true);
      expect(JSON.stringify(events)).not.toContain('management-test-secret');
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test('does not log sensitive upstream response content after a failed mutation', async () => {
    const proxy = createServer(async (request, response) => {
      if (request.url === '/v0/management/auth-files') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            files: [
              {
                auth_index: 'credential-1',
                name: 'codex-ada.json',
                provider: 'codex',
                email: 'ada@company.example',
              },
            ],
          }),
        );
      } else {
        response
          .writeHead(500, { 'content-type': 'application/json' })
          .end('{"error":"token=super-secret"}');
      }
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
      const response = await fetch(
        `${server.origin}/api/admin/pool/credentials/credential-1/refresh`,
        {
          method: 'POST',
          headers: { cookie },
        },
      );
      expect(await response.json()).toEqual({ status: 'unavailable' });
      const audit = await fetch(`${server.origin}/api/admin/pool/audit`, { headers: { cookie } });
      const text = await audit.text();
      expect(text).toContain('refresh');
      expect(text).toContain('failed');
      expect(text).not.toContain('super-secret');
      expect(text).not.toContain('management-test-secret');
    } finally {
      await server.stop();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
