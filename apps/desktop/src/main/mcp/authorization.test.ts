import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SecretKeeper } from '../auth/keys.ts';
import { ThreadStore } from '../db/threads.ts';
import { mcpManager } from './servers.ts';
import { mcpSecretStore } from './secrets.ts';
import { mcpOAuth } from './authorization.ts';

function keyring(): SecretKeeper {
  const flip = (bytes: Buffer) => Buffer.from([...bytes].map((byte) => byte ^ 0x5a));
  return {
    available: () => true,
    backend: () => 'gnome_libsecret',
    encrypt: async (plaintext) => flip(Buffer.from(plaintext)),
    decrypt: async (ciphertext) => flip(ciphertext).toString('utf8'),
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No loopback port was assigned.');
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function json(response: import('node:http').ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function body(request: import('node:http').IncomingMessage): Promise<string> {
  let value = '';
  for await (const chunk of request) value += chunk;
  return value;
}

async function authorizationFixture() {
  let verifier: string | undefined;
  const exchanges: URLSearchParams[] = [];
  const registration: Record<string, unknown>[] = [];
  const resource = createServer(async (request, response) => {
    if (request.url?.startsWith('/.well-known/oauth-protected-resource')) {
      json(response, {
        resource: `http://127.0.0.1:${resourcePort}/mcp`,
        authorization_servers: [`http://127.0.0.1:${authPort}`],
        scopes_supported: ['mcp:tools'],
      });
      return;
    }
    if (request.url === '/mcp' && request.method === 'POST') {
      if (request.headers.authorization !== 'Bearer fixture-refreshed-token') {
        response.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="http://127.0.0.1:${resourcePort}/.well-known/oauth-protected-resource"`,
        });
        response.end();
        return;
      }
      const asked = JSON.parse(await body(request)) as {
        id?: number | string;
        method?: string;
        params?: { protocolVersion?: string };
      };
      if (asked.method === 'notifications/initialized') {
        response.writeHead(202).end();
        return;
      }
      json(response, {
        jsonrpc: '2.0',
        id: asked.id,
        result: asked.method === 'initialize'
          ? {
              protocolVersion: asked.params?.protocolVersion ?? '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1.0.0' },
            }
          : asked.method === 'tools/list'
            ? { tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object' } }] }
            : {},
      });
      return;
    }
    response.writeHead(401, { 'www-authenticate': 'Bearer' });
    response.end();
  });
  const resourcePort = await listen(resource);
  const auth = createServer(async (request, response) => {
    if (request.url === '/.well-known/oauth-authorization-server') {
      json(response, {
        issuer: `http://127.0.0.1:${authPort}`,
        authorization_endpoint: `http://127.0.0.1:${authPort}/authorize`,
        token_endpoint: `http://127.0.0.1:${authPort}/token`,
        registration_endpoint: `http://127.0.0.1:${authPort}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
      return;
    }
    if (request.url === '/register' && request.method === 'POST') {
      registration.push(JSON.parse(await body(request)) as Record<string, unknown>);
      json(response, {
        client_id: 'fixture-client-id',
        redirect_uris: registration[0]?.['redirect_uris'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
      return;
    }
    if (request.url === '/token' && request.method === 'POST') {
      const exchange = new URLSearchParams(await body(request));
      exchanges.push(exchange);
      json(response, exchange.get('grant_type') === 'refresh_token'
        ? { access_token: 'fixture-refreshed-token', token_type: 'Bearer', expires_in: 3600 }
        : {
            access_token: 'fixture-access-token',
            refresh_token: 'fixture-refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
          });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const authPort = await listen(auth);
  const authOrigin = `http://127.0.0.1:${authPort}`;
  const resourceUrl = `http://127.0.0.1:${resourcePort}/mcp`;

  return {
    resource,
    auth,
    authOrigin,
    resourceUrl,
    exchanges,
    registration,
    get verifier() { return verifier; },
    async openExternal(
      url: URL,
      secrets: ReturnType<typeof mcpSecretStore>,
      serverId = 'server-1',
      callbackIssuer = authOrigin,
    ): Promise<void> {
      const state = url.searchParams.get('state');
      const redirect = url.searchParams.get('redirect_uri');
      assert.ok(state);
      assert.ok(redirect);
      verifier = secrets.readOAuth(serverId)?.codeVerifier;
      assert.ok(verifier, 'PKCE verifier is stored before the browser opens');
      assert.equal(
        url.searchParams.get('code_challenge'),
        createHash('sha256').update(verifier).digest('base64url'),
      );

      const invalid = new URL(redirect);
      invalid.searchParams.set('code', 'attacker-code');
      invalid.searchParams.set('state', `${state}-wrong`);
      invalid.searchParams.set('iss', authOrigin);
      const rejected = await fetch(invalid);
      assert.equal(rejected.status, 400);

      const callback = new URL(redirect);
      callback.searchParams.set('code', 'approved-code');
      callback.searchParams.set('state', state);
      callback.searchParams.set('iss', callbackIssuer);
      const accepted = await fetch(callback);
      assert.equal(accepted.status, 200);
    },
    async close() {
      await Promise.all([close(resource), close(auth)]);
    },
  };
}

interface Case {
  name: string;
  run(): Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'authorizes through a loopback callback and persists only encrypted OAuth state',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path });
      const manager = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets),
      });

      try {
        await secrets.load();
        await manager.authorize('server-1', fixture.resourceUrl);

        assert.equal(fixture.registration.length, 1);
        assert.equal(fixture.exchanges.length, 1);
        assert.equal(fixture.exchanges[0]?.get('code'), 'approved-code');
        assert.equal(fixture.exchanges[0]?.get('iss'), null);
        assert.equal(fixture.exchanges[0]?.get('code_verifier'), fixture.verifier);
        assert.equal(fixture.exchanges[0]?.get('redirect_uri')?.startsWith('http://127.0.0.1:'), true);
        assert.deepEqual(secrets.readOAuth('server-1')?.tokens, {
          access_token: 'fixture-access-token',
          refresh_token: 'fixture-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          issuer: fixture.authOrigin,
        });
        assert.equal(secrets.readOAuth('server-1')?.codeVerifier, undefined);
        assert.equal(
          secrets.readOAuth('server-1')?.discoveryState?.authorizationServerUrl,
          fixture.authOrigin,
        );
        assert.equal(secrets.persistedOAuth('server-1'), true);
        const sealed = await readFile(join(path, 'server-1.oauth.json'), 'utf8');
        for (const secret of ['fixture-client-id', 'fixture-access-token', 'fixture-refresh-token']) {
          assert.equal(sealed.includes(secret), false);
        }
      } finally {
        await manager.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'reports when OS-backed encryption is unavailable without opening the browser',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({
        secrets: { ...keyring(), available: () => false },
        path,
      });
      let opened = false;
      const manager = mcpOAuth({
        secrets,
        openExternal: async () => { opened = true; },
      });

      try {
        await secrets.load();
        await assert.rejects(
          manager.authorize('server-1', fixture.resourceUrl),
          /OAuth credentials require OS-backed encrypted storage/u,
        );
        assert.equal(opened, false);
        assert.equal(secrets.persistedOAuth('server-1'), false);
      } finally {
        await manager.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'rejects a wrong callback state without exchanging its authorization code',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path });
      const manager = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets),
      });

      try {
        await secrets.load();
        await manager.authorize('server-1', fixture.resourceUrl);

        assert.deepEqual(fixture.exchanges.map((exchange) => exchange.get('code')), ['approved-code']);
        assert.equal(secrets.readOAuth('server-1')?.tokens?.access_token, 'fixture-access-token');
      } finally {
        await manager.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'rejects a callback from a mismatched authorization-server issuer',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path });
      const manager = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets, 'server-1', 'http://127.0.0.1:9'),
      });

      try {
        await secrets.load();
        await assert.rejects(
          manager.authorize('server-1', fixture.resourceUrl),
          /Could not complete MCP sign-in/u,
        );
        assert.equal(fixture.exchanges.length, 0);
        assert.equal(secrets.readOAuth('server-1')?.tokens, undefined);
      } finally {
        await manager.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'MCP manager signs in, refreshes tokens, reconnects, and signs out',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path: join(path, 'secrets') });
      const store = new ThreadStore(join(path, 'threads.db'));
      const server = store.createMcpServer({
        name: 'protected',
        transport: 'streamable-http',
        command: '',
        args: [],
        cwd: null,
        url: fixture.resourceUrl,
      });
      const oauth = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets, server.id),
      });
      const manager = mcpManager({ store, secrets, oauth });

      try {
        await manager.start();
        assert.equal(
          manager.snapshot(server.id)?.status,
          'needs-sign-in',
          JSON.stringify(manager.snapshot(server.id)),
        );
        assert.equal(manager.snapshot(server.id)?.hasOAuth, false);

        await manager.signIn(server.id);
        assert.equal(manager.snapshot(server.id)?.status, 'connected');
        assert.equal(manager.snapshot(server.id)?.hasOAuth, true);
        assert.deepEqual(manager.snapshot(server.id)?.tools.map((tool) => tool.toolName), ['echo']);
        assert.equal(fixture.exchanges[0]?.get('grant_type'), 'authorization_code');
        assert.equal(fixture.exchanges[1]?.get('grant_type'), 'refresh_token');
        assert.equal(secrets.readOAuth(server.id)?.tokens?.access_token, 'fixture-refreshed-token');
        assert.equal(secrets.readOAuth(server.id)?.tokens?.refresh_token, 'fixture-refresh-token');

        await manager.signOut(server.id);
        assert.equal(manager.snapshot(server.id)?.status, 'needs-sign-in');
        assert.equal(
          manager.snapshot(server.id)?.hasOAuth,
          false,
          JSON.stringify({ snapshot: manager.snapshot(server.id), stored: secrets.readOAuth(server.id) }),
        );
      } finally {
        await manager.close();
        store.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'disabling a server cancels a pending browser sign-in',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path: join(path, 'secrets') });
      const store = new ThreadStore(join(path, 'threads.db'));
      const server = store.createMcpServer({
        name: 'protected',
        transport: 'streamable-http',
        command: '',
        args: [],
        cwd: null,
        url: fixture.resourceUrl,
      });
      let signalOpened!: () => void;
      const browserOpened = new Promise<void>((resolve) => { signalOpened = resolve; });
      const oauth = mcpOAuth({ secrets, openExternal: async () => { signalOpened(); } });
      const manager = mcpManager({ store, secrets, oauth });

      try {
        await manager.start();
        const signIn = manager.signIn(server.id);
        await browserOpened;
        await manager.setEnabled(server.id, false);
        await assert.rejects(signIn, /cancelled/u);
        assert.equal(manager.snapshot(server.id)?.status, 'disabled');
        assert.equal(secrets.hasOAuth(server.id), false);
      } finally {
        await manager.close();
        store.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'changing an HTTP server URL drops its saved OAuth credentials',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path: join(path, 'secrets') });
      const store = new ThreadStore(join(path, 'threads.db'));
      const server = store.createMcpServer({
        name: 'protected',
        transport: 'streamable-http',
        command: '',
        args: [],
        cwd: null,
        url: fixture.resourceUrl,
      });
      const oauth = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets, server.id),
      });
      const manager = mcpManager({ store, secrets, oauth });

      try {
        await manager.start();
        await manager.signIn(server.id);
        assert.equal(secrets.hasOAuth(server.id), true);

        await manager.update(server.id, {
          scope: 'global',
          workspaceId: null,
          name: server.name,
          transport: 'streamable-http',
          command: '',
          args: [],
          cwd: null,
          url: new URL('/different-mcp', fixture.resourceUrl).toString(),
          toolSelection: 'all',
        });

        assert.equal(secrets.hasOAuth(server.id), false);
        await assert.rejects(readFile(join(path, 'secrets', `${server.id}.oauth.json`)), { code: 'ENOENT' });
        assert.equal(manager.snapshot(server.id)?.hasOAuth, false);
        assert.equal(manager.snapshot(server.id)?.status, 'needs-sign-in');
      } finally {
        await manager.close();
        store.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'sign-out clears OAuth credentials but leaves static server credentials intact',
    async run() {
      const path = await mkdtemp(join(tmpdir(), 'foundry-mcp-oauth-'));
      const fixture = await authorizationFixture();
      const secrets = mcpSecretStore({ secrets: keyring(), path });
      const manager = mcpOAuth({
        secrets,
        openExternal: (url) => fixture.openExternal(url, secrets),
      });

      try {
        await secrets.load();
        await secrets.update('server-1', { headers: { 'x-api-key': 'static-secret' } });
        await manager.authorize('server-1', fixture.resourceUrl);
        await manager.signOut('server-1');

        assert.equal(secrets.hasOAuth('server-1'), false);
        assert.deepEqual(secrets.read('server-1'), { headers: { 'x-api-key': 'static-secret' } });
      } finally {
        await manager.close();
        await fixture.close();
        await rm(path, { recursive: true, force: true });
      }
    },
  },
];

test('MCP OAuth authorization stays in the main-process loopback flow', async (context) => {
  for (const testCase of CASES) {
    await context.test(testCase.name, testCase.run);
  }
});
