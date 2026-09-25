import { strict as assert } from 'node:assert';
import { createServer, type IncomingMessage } from 'node:http';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ThreadStore } from '../db/threads.ts';
import type { SecretKeeper } from '../auth/keys.ts';
import { resolveCommand } from './command.ts';
import { mcpSecretStore, type McpSecretStore } from './secrets.ts';
import { tempDir } from '../test-support/temp.ts';
import { mcpManager } from './servers.ts';

function storePath(): string {
  return join(tempDir('kira-mcp-'), 'threads.db');
}

function secretStore({
  path = join(tempDir('kira-mcp-secrets-'), 'credentials'),
  available = true,
}: { path?: string; available?: boolean } = {}) {
  const flip = (bytes: Buffer) => Buffer.from([...bytes].map((byte) => byte ^ 0x5a));
  const secrets: SecretKeeper = {
    available: () => available,
    backend: () => 'test-keyring',
    encrypt: async (plaintext) => flip(Buffer.from(plaintext)),
    decrypt: async (ciphertext) => flip(ciphertext).toString('utf8'),
  };
  return mcpSecretStore({ secrets, path });
}

function fixturePath({ answerInitialize = true, listChanged = false } = {}): {
  path: string;
  stopped: string;
  started: string;
} {
  const folder = tempDir('kira-mcp-server-');
  const stopped = join(folder, 'stopped');
  const started = join(folder, 'started');
  const path = join(folder, 'server.mjs');

  writeFileSync(
    path,
    `import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const stopped = process.argv[2];
const started = process.argv[3];
const answerInitialize = ${answerInitialize ? 'true' : 'false'};
const listChanged = ${listChanged ? 'true' : 'false'};
let listRequests = 0;
const output = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
const notification = (method, params) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\\n');
const input = createInterface({ input: process.stdin });
input.on('close', () => { writeFileSync(stopped, 'yes'); process.exit(0); });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    writeFileSync(started, 'yes');
    if (!answerInitialize) return;
    output(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged } }, serverInfo: { name: 'fixture', version: '1.0.0' } });
  } else if (request.method === 'tools/list') {
    listRequests++;
    const tools = [{ name: 'echo', description: 'Echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }];
    if (listRequests > 1) tools.push({ name: 'later', description: 'Added later', inputSchema: { type: 'object', properties: {} } });
    output(request.id, { tools });
    if (listChanged && listRequests === 1) notification('notifications/tools/list_changed', {});
  } else if (request.method === 'tools/call') {
    const secret = process.env.MCP_FIXTURE_SECRET;
    output(request.id, { content: [{ type: 'text', text: 'fixture: ' + (secret ? secret + ': ' : '') + request.params.arguments.message }] });
  }
});
process.on('SIGTERM', () => { writeFileSync(stopped, 'yes'); process.exit(0); });
`,
  );

  return { path, stopped, started };
}

function requestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 5000) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('a global stdio MCP server connects, exposes its tool and shuts down', async () => {
  const server = fixturePath();
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'fixture',
    command: process.execPath,
    args: [server.path, server.stopped, server.started],
    cwd: null,
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(
      () => manager.snapshot(saved.id)?.status === 'connected',
      'the MCP server to connect',
    );

    assert.deepEqual(manager.tools(), [
      {
        name: 'fixture_echo',
        serverId: saved.id,
        serverName: 'fixture',
        toolName: 'echo',
        description: 'Echo a message',
        selected: true,
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
    ]);

    const result = await manager.callTool('fixture_echo', { message: 'hello' });
    assert.deepEqual(result.content, [{ type: 'text', text: 'fixture: hello' }]);
    assert.equal(result.isError, undefined);
  } finally {
    await manager.close();
    await waitFor(
      () => existsSync(server.stopped) && readFileSync(server.stopped, 'utf8') === 'yes',
      'the MCP process to stop',
    );
    store.close();
  }
});

test('closing while an MCP server is initializing still stops its process', async () => {
  const server = fixturePath({ answerInitialize: false });
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'hanging-fixture',
    command: process.execPath,
    args: [server.path, server.stopped, server.started],
    cwd: null,
  });
  const manager = mcpManager({ store });

  try {
    const startup = manager.start();
    await waitFor(() => existsSync(server.started), 'the MCP fixture to receive initialize');
    await manager.close();
    await startup;
    assert.equal(manager.snapshot(saved.id)?.status, 'connecting');
    await waitFor(
      () => existsSync(server.stopped) && readFileSync(server.stopped, 'utf8') === 'yes',
      'the initializing MCP process to stop',
    );
  } finally {
    await manager.close();
    store.close();
  }
});

test('tool selection controls chat tools and disabling stops the server', async () => {
  const server = fixturePath();
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'fixture',
    command: process.execPath,
    args: [server.path, server.stopped, server.started],
    cwd: null,
    toolSelection: [],
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the selected MCP server');
    assert.equal(manager.snapshot(saved.id)?.tools[0]?.selected, false);
    assert.deepEqual(manager.tools(), []);
    await assert.rejects(manager.callTool('fixture_echo', { message: 'hidden' }), /server disconnected/);

    await manager.setToolSelection(saved.id, ['echo']);
    assert.equal(manager.snapshot(saved.id)?.tools[0]?.selected, true);
    assert.equal((await manager.callTool('fixture_echo', { message: 'shown' })).content?.[0]?.type, 'text');

    await manager.setEnabled(saved.id, false);
    assert.equal(manager.snapshot(saved.id)?.status, 'disabled');
    assert.deepEqual(manager.tools(), []);
    await waitFor(() => existsSync(server.stopped), 'the disabled MCP process');

    await manager.setEnabled(saved.id, true);
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the re-enabled MCP server');
  } finally {
    await manager.close();
    await waitFor(
      () => existsSync(server.stopped) && readFileSync(server.stopped, 'utf8') === 'yes',
      'the selected MCP process to stop',
    );
    store.close();
  }
});

test('workspace MCP servers start on first chat and override only their workspace', async () => {
  const globalFixture = fixturePath();
  const firstFixture = fixturePath();
  const secondFixture = fixturePath();
  const store = new ThreadStore(storePath());
  const firstWorkspace = store.rememberWorkspace(tempDir('kira-mcp-workspace-a-'));
  const secondWorkspace = store.rememberWorkspace(tempDir('kira-mcp-workspace-b-'));
  const command = (fixture: ReturnType<typeof fixturePath>) => ({
    command: process.execPath,
    args: [fixture.path, fixture.stopped, fixture.started],
    cwd: null,
  });
  const global = store.createMcpServer({ name: 'shared', ...command(globalFixture) });
  const first = store.createMcpServer({
    scope: 'workspace',
    workspaceId: firstWorkspace.id,
    name: 'shared',
    ...command(firstFixture),
  });
  const second = store.createMcpServer({
    scope: 'workspace',
    workspaceId: secondWorkspace.id,
    name: 'shared',
    ...command(secondFixture),
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(global.id)?.status === 'connected', 'the global MCP server');
    assert.equal(existsSync(firstFixture.started), false);
    assert.equal(existsSync(secondFixture.started), false);

    await manager.connectWorkspace(firstWorkspace.id);
    await waitFor(() => manager.snapshot(first.id)?.status === 'connected', 'the first workspace MCP server');
    assert.equal(manager.tools(null)[0]?.serverId, global.id);
    assert.equal(manager.tools(firstWorkspace.id)[0]?.serverId, first.id);
    assert.equal(existsSync(secondFixture.started), false);

    await manager.connectWorkspace(secondWorkspace.id);
    await waitFor(() => manager.snapshot(second.id)?.status === 'connected', 'the second workspace MCP server');
    assert.equal(manager.tools(secondWorkspace.id)[0]?.serverId, second.id);

    await manager.forgetWorkspace(firstWorkspace.id);
    assert.equal(manager.snapshot(first.id), undefined);
    await waitFor(() => existsSync(firstFixture.stopped), 'the forgotten workspace MCP process');
  } finally {
    await manager.close();
    await waitFor(() => existsSync(globalFixture.stopped), 'the global MCP process to stop');
    await waitFor(() => existsSync(firstFixture.stopped), 'the first workspace MCP process to stop');
    await waitFor(() => existsSync(secondFixture.stopped), 'the second workspace MCP process to stop');
    store.close();
  }
});

test('a missing local command reports a clear failed status', async () => {
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'missing',
    command: '/definitely/not-a-real-mcp-command',
    args: [],
    cwd: null,
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'failed', 'the missing command to fail');
    assert.equal(manager.snapshot(saved.id)?.error, 'Command not found: /definitely/not-a-real-mcp-command');
  } finally {
    await manager.close();
    store.close();
  }
});

test('editing a server reconnects only that server with its new configuration', async () => {
  const first = fixturePath();
  const second = fixturePath();
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'first',
    command: process.execPath,
    args: [first.path, first.stopped, first.started],
    cwd: null,
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the first MCP server');
    const updated = await manager.update(saved.id, {
      name: 'second',
      command: process.execPath,
      args: [second.path, second.stopped, second.started],
      cwd: null,
    });
    assert.equal(updated.name, 'second');
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the edited MCP server');
    assert.deepEqual(manager.tools().map((tool) => tool.name), ['second_echo']);
    await waitFor(() => existsSync(first.stopped), 'the old MCP process');
  } finally {
    await manager.close();
    await waitFor(() => existsSync(second.stopped), 'the edited MCP process to stop');
    store.close();
  }
});

test('a PATH-resolved npx command starts without a shell-provided absolute path', async () => {
  const server = fixturePath();
  const folder = tempDir('kira-mcp-npx-');
  const npx = join(folder, 'npx');
  writeFileSync(npx, `#!/bin/sh\nexec "$@"\n`, { mode: 0o755 });
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'npx-fixture',
    command: 'npx',
    args: [process.execPath, server.path, server.stopped, server.started],
    cwd: null,
  });
  const manager = mcpManager({
    store,
    commandResolver: (command) => resolveCommand(command, {
      path: folder,
      platform: process.platform,
      execPath: process.execPath,
    }),
  });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the PATH-resolved npx MCP server');
  } finally {
    await manager.close();
    await waitFor(() => existsSync(server.stopped), 'the PATH-resolved MCP process to stop');
    store.close();
  }
});

test('tools/list_changed refreshes the settings snapshot and selected chat tools', async () => {
  const server = fixturePath({ listChanged: true });
  const store = new ThreadStore(storePath());
  const saved = store.createMcpServer({
    name: 'changing',
    command: process.execPath,
    args: [server.path, server.stopped, server.started],
    cwd: null,
  });
  const manager = mcpManager({ store });

  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the changing MCP server');
    await waitFor(() => manager.snapshot(saved.id)?.tools.length === 2, 'the refreshed MCP tools');
    assert.deepEqual(manager.tools().map((tool) => tool.toolName), ['echo', 'later']);

    await manager.setToolSelection(saved.id, ['echo']);
    assert.deepEqual(manager.tools().map((tool) => tool.toolName), ['echo']);
    assert.equal(manager.snapshot(saved.id)?.tools.find((tool) => tool.toolName === 'later')?.selected, false);

    await manager.setToolSelection(saved.id, 'all');
    assert.deepEqual(manager.tools().map((tool) => tool.toolName), ['echo', 'later']);
  } finally {
    await manager.close();
    await waitFor(() => existsSync(server.stopped), 'the changing MCP process to stop');
    store.close();
  }
});

const CREDENTIAL_CASES: Array<{ name: string; run(): Promise<void> }> = [
  {
    name: 'failed credential persistence leaves no orphan server record',
    async run() {
      const store = new ThreadStore(storePath());
      let hasCredentials = false;
      const secrets: McpSecretStore = {
        load: async () => {},
        snapshot: async () => ({
          credentials: undefined,
          oauth: undefined,
          sealedFile: undefined,
          sealedOAuthFile: undefined,
        }),
        restore: async () => {},
        read: () => undefined,
        has: () => hasCredentials,
        persisted: () => hasCredentials,
        update: async () => {
          hasCredentials = true;
          throw new Error('credential write failed');
        },
        readOAuth: () => undefined,
        hasOAuth: () => false,
        persistedOAuth: () => false,
        updateOAuth: async () => {},
        clearOAuth: async () => {},
        forget: async () => { hasCredentials = false; },
      };
      const manager = mcpManager({ store, secrets });

      try {
        await manager.start();
        await assert.rejects(
          manager.add({
            name: 'fixture', command: 'node', args: [], cwd: null,
            credentials: { env: { TOKEN: 'secret' } },
          }),
          /credential write failed/,
        );
        assert.deepEqual(store.listMcpServers(), []);
        assert.equal(hasCredentials, false);
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'a failed server edit preserves credentials for the existing identity',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const manager = mcpManager({ store, secrets: credentials });

      try {
        const saved = await manager.add({
          name: 'first', command: 'node', args: [], cwd: null,
          credentials: { env: { TOKEN: 'first-secret' } },
        });
        await manager.add({ name: 'taken', command: 'node', args: [], cwd: null });

        await assert.rejects(manager.update(saved.id, {
          name: 'taken', command: 'node-next', args: [], cwd: null,
        }));

        assert.equal(store.findMcpServer(saved.id)?.name, 'first');
        assert.deepEqual(credentials.read(saved.id), { env: { TOKEN: 'first-secret' } });
        assert.equal(credentials.has(saved.id), true);
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'a failed credential replacement rolls back the server edit',
    async run() {
      const store = new ThreadStore(storePath());
      const saved = store.createMcpServer({ name: 'first', command: 'node', args: [], cwd: null });
      const persisted = secretStore();
      await persisted.update(saved.id, { env: { TOKEN: 'first-secret' } });
      let failReplacement = false;
      const secrets: McpSecretStore = {
        load: () => persisted.load(),
        snapshot: (id) => persisted.snapshot(id),
        restore: (id, snapshot) => persisted.restore(id, snapshot),
        read: (id) => persisted.read(id),
        has: (id) => persisted.has(id),
        persisted: (id) => persisted.persisted(id),
        update: async (id, change) => {
          if (failReplacement) throw new Error('credential write failed');
          await persisted.update(id, change);
        },
        readOAuth: (id) => persisted.readOAuth(id),
        hasOAuth: (id) => persisted.hasOAuth(id),
        persistedOAuth: (id) => persisted.persistedOAuth(id),
        updateOAuth: (id, change) => persisted.updateOAuth(id, change),
        clearOAuth: (id) => persisted.clearOAuth(id),
        forget: (id) => persisted.forget(id),
      };
      const manager = mcpManager({ store, secrets });

      try {
        failReplacement = true;
        await assert.rejects(manager.update(saved.id, {
          name: 'renamed', command: 'node', args: [], cwd: null,
          credentials: { env: { TOKEN: 'replacement-secret' } },
        }), /credential write failed/);

        assert.equal(store.findMcpServer(saved.id)?.name, 'first');
        assert.deepEqual(persisted.read(saved.id), { env: { TOKEN: 'first-secret' } });
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'a failed edit restores encrypted credentials unavailable on this device',
    async run() {
      const path = join(tempDir('kira-mcp-secrets-'), 'credentials');
      const store = new ThreadStore(storePath());
      const saved = store.createMcpServer({ name: 'first', command: 'node', args: [], cwd: null });
      store.createMcpServer({ name: 'taken', command: 'node', args: [], cwd: null });
      await secretStore({ path }).update(saved.id, { env: { TOKEN: 'first-secret' } });
      const inaccessible = secretStore({ path, available: false });
      const manager = mcpManager({ store, secrets: inaccessible });

      try {
        await assert.rejects(manager.update(saved.id, {
          name: 'taken', command: 'node-next', args: [], cwd: null,
        }));

        const reopened = secretStore({ path });
        await reopened.load();
        assert.deepEqual(reopened.read(saved.id), { env: { TOKEN: 'first-secret' } });
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'stdio servers receive saved environment variables',
    async run() {
      const server = fixturePath();
      const store = new ThreadStore(storePath());
      const manager = mcpManager({ store, secrets: secretStore() });

      try {
        await manager.start();
        const saved = await manager.add({
          name: 'fixture',
          command: process.execPath,
          args: [server.path, server.stopped, server.started],
          cwd: null,
          credentials: { env: { MCP_FIXTURE_SECRET: 'env-secret' } },
        });
        await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the credentialed stdio server');

        assert.equal(manager.snapshot(saved.id)?.hasCredentials, true);
        assert.deepEqual(
          (await manager.callTool('fixture_echo', { message: 'hello' })).content,
          [{ type: 'text', text: 'fixture: env-secret: hello' }],
        );
      } finally {
        await manager.close();
        await waitFor(() => existsSync(server.stopped), 'the credentialed MCP process to stop');
        store.close();
      }
    },
  },
  {
    name: 'changing only the transport drops saved credentials',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const saved = store.createMcpServer({
        name: 'switching',
        transport: 'streamable-http',
        command: 'node',
        args: [],
        cwd: null,
        url: 'https://switching.example/mcp',
      });
      await credentials.update(saved.id, { headers: { 'x-api-key': 'switch-secret' } });
      const manager = mcpManager({ store, secrets: credentials });

      try {
        await manager.update(saved.id, {
          name: 'switching', transport: 'stdio', command: 'node', args: [], cwd: null,
        });

        assert.equal(manager.snapshot(saved.id)?.hasCredentials, false);
        assert.equal(credentials.has(saved.id), false);
        assert.equal(store.findMcpServer(saved.id)?.transport, 'stdio');
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'changing a command or URL drops saved credentials',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const manager = mcpManager({ store, secrets: credentials });
      try {
        const local = await manager.add({
          name: 'local',
          command: 'node',
          args: [],
          cwd: null,
          credentials: { env: { TOKEN: 'local-secret' } },
        });
        const switching = await manager.add({
          name: 'switching', command: 'node', args: [], cwd: null,
          credentials: { env: { TOKEN: 'switching-secret' } },
        });
        const remote = await manager.add({
          name: 'remote',
          transport: 'streamable-http',
          command: '',
          args: [],
          cwd: null,
          url: 'https://one.example/mcp',
          credentials: { bearerToken: 'remote-secret' },
        });
        assert.equal(local.hasCredentials, true);
        assert.equal(remote.hasCredentials, true);

        await manager.update(local.id, {
          name: 'local', command: 'node-next', args: [], cwd: null,
        });
        await manager.update(remote.id, {
          name: 'remote', transport: 'streamable-http', command: '', args: [], cwd: null,
          url: 'https://two.example/mcp',
        });
        await manager.update(switching.id, {
          name: 'switching', transport: 'streamable-http', command: '', args: [], cwd: null,
          url: 'https://changed.example/mcp',
        });

        assert.equal(manager.snapshot(switching.id)?.hasCredentials, false);
        assert.equal(credentials.has(switching.id), false);
        assert.equal(manager.snapshot(local.id)?.hasCredentials, false);
        assert.equal(manager.snapshot(remote.id)?.hasCredentials, false);
        assert.equal(credentials.has(local.id), false);
        assert.equal(credentials.has(remote.id), false);
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'a failed server deletion preserves its record and credentials',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const manager = mcpManager({ store, secrets: credentials });
      let deleteServer: ThreadStore['deleteMcpServer'] | undefined;

      try {
        const saved = await manager.add({
          name: 'fixture', command: 'node', args: [], cwd: null,
          credentials: { env: { TOKEN: 'keep-secret' } },
        });
        deleteServer = store.deleteMcpServer.bind(store);
        store.deleteMcpServer = () => { throw new Error('database delete failed'); };

        await assert.rejects(manager.remove(saved.id), /database delete failed/);
        assert.ok(store.findMcpServer(saved.id));
        assert.deepEqual(credentials.read(saved.id), { env: { TOKEN: 'keep-secret' } });
        assert.ok(manager.snapshot(saved.id));
      } finally {
        if (deleteServer !== undefined) store.deleteMcpServer = deleteServer;
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'changing only stdio arguments drops saved credentials',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const manager = mcpManager({ store, secrets: credentials });

      try {
        const saved = await manager.add({
          name: 'stdio', command: 'node', args: ['first.mjs'], cwd: null,
          credentials: { env: { TOKEN: 'args-secret' } },
        });
        await manager.update(saved.id, {
          name: 'stdio', command: 'node', args: ['second.mjs'], cwd: null,
        });

        assert.equal(manager.snapshot(saved.id)?.hasCredentials, false);
        assert.equal(credentials.has(saved.id), false);
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'changing only the stdio working folder drops saved credentials',
    async run() {
      const store = new ThreadStore(storePath());
      const credentials = secretStore();
      const manager = mcpManager({ store, secrets: credentials });

      try {
        const saved = await manager.add({
          name: 'stdio', command: 'node', args: ['server.mjs'], cwd: '/first',
          credentials: { env: { TOKEN: 'cwd-secret' } },
        });
        await manager.update(saved.id, {
          name: 'stdio', command: 'node', args: ['server.mjs'], cwd: '/second',
        });

        assert.equal(manager.snapshot(saved.id)?.hasCredentials, false);
        assert.equal(credentials.has(saved.id), false);
      } finally {
        await manager.close();
        store.close();
      }
    },
  },
  {
    name: 'Streamable HTTP servers receive saved headers and bearer tokens',
    async run() {
      const receivedHeaders: Array<{
        key: string | string[] | undefined;
        authorization: string | string[] | undefined;
      }> = [];
      const http = createServer(async (request, response) => {
        receivedHeaders.push({
          key: request.headers['x-api-key'],
          authorization: request.headers.authorization,
        });
        const body = JSON.parse(await requestBody(request)) as { id?: number; method?: string };
        response.setHeader('content-type', 'application/json');
        response.setHeader('mcp-session-id', 'fixture-http-session');
        const result = body.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1.0.0' } }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'remote_echo', description: 'Remote echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }
            : { content: [{ type: 'text', text: 'remote: hello' }] };
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      });
      const store = new ThreadStore(storePath());
      const manager = mcpManager({ store, secrets: secretStore() });
      let listening = false;

      try {
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        listening = true;
        const address = http.address();
        if (address === null || typeof address === 'string') throw new Error('the HTTP fixture has no port');

        await manager.start();
        const saved = await manager.add({
          name: 'remote',
          transport: 'streamable-http',
          command: '',
          args: [],
          cwd: null,
          url: `http://127.0.0.1:${address.port}/mcp`,
          credentials: {
            headers: { 'x-api-key': 'header-secret' },
            bearerToken: 'bearer-secret',
          },
        });
        await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the HTTP MCP server');
        assert.deepEqual(manager.tools().map((tool) => tool.name), ['remote_remote_echo']);
        assert.deepEqual((await manager.callTool('remote_remote_echo', { message: 'hello' })).content, [
          { type: 'text', text: 'remote: hello' },
        ]);
        assert.ok(receivedHeaders.length > 0);
        assert.ok(receivedHeaders.every((headers) => (
          headers.key === 'header-secret' && headers.authorization === 'Bearer bearer-secret'
        )));
      } finally {
        await manager.close();
        store.close();
        if (listening) {
          await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
        }
      }
    },
  },
];

test('MCP server credentials reach transports and are invalidated with server identity', async (context) => {
  for (const testCase of CREDENTIAL_CASES) {
    await context.test(testCase.name, testCase.run);
  }
});

test('adding and removing a global MCP server changes the manager snapshot', async () => {
  const server = fixturePath();
  const store = new ThreadStore(storePath());
  const manager = mcpManager({ store });
  try {
    await manager.start();

    const saved = await manager.add({
      name: 'fixture',
      command: process.execPath,
      args: [server.path, server.stopped, server.started],
      cwd: null,
    });
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the added server');

    await manager.remove(saved.id);
    assert.equal(manager.snapshot(saved.id), undefined);
    await assert.rejects(
      manager.callTool('fixture_echo', { message: 'after removal' }),
      (error: Error) => error.message === 'server disconnected',
    );
    assert.deepEqual(store.listMcpServers(), []);
    await waitFor(
      () => existsSync(server.stopped) && readFileSync(server.stopped, 'utf8') === 'yes',
      'the removed MCP process',
    );
  } finally {
    await manager.close();
    store.close();
  }
});
