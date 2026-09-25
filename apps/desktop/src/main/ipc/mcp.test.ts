import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { McpDeps } from './mcp.ts';
import type { McpServer, McpServerDraft } from '../../preload/bridge.ts';
import { mcpHandlers } from './mcp.ts';

const SERVER: McpServer = {
  id: 'server-1',
  scope: 'global',
  workspaceId: null,
  name: 'fixture',
  transport: 'stdio',
  command: 'node',
  args: ['server.mjs'],
  cwd: null,
  url: null,
  toolSelection: 'all',
  enabled: true,
  status: 'connected',
  error: null,
  tools: [],
  hasCredentials: false,
  credentialsPersisted: false,
  hasOAuth: false,
  oauthCredentialsPersisted: false,
};

function dependencies(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    list: () => [],
    add: async () => SERVER,
    update: async () => SERVER,
    remove: async () => undefined,
    reconnect: async () => undefined,
    setEnabled: async () => undefined,
    setToolSelection: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
    ...overrides,
  };
}

test('MCP handlers validate and forward a global server draft', async () => {
  const added: McpServerDraft[] = [];
  const handlers = mcpHandlers(dependencies({
    list: () => [],
    add: async (draft) => {
      added.push(draft);
      return SERVER;
    },
  }));

  assert.deepEqual(await handlers.load(), { ok: true, value: [] });
  assert.deepEqual(
    await handlers.add({
      name: ' fixture ', command: ' node ', args: ['server.mjs'], cwd: '',
      credentials: { env: { MCP_TOKEN: 'stdio-secret' } },
    }),
    { ok: true, value: SERVER },
  );
  assert.deepEqual(added, [{
    scope: 'global',
    workspaceId: null,
    name: 'fixture',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    cwd: null,
    url: null,
    toolSelection: 'all',
    credentials: { env: { MCP_TOKEN: 'stdio-secret' } },
  }]);
});

test('a duplicate global MCP server name is refused clearly', async () => {
  let called = false;
  const handlers = mcpHandlers(dependencies({
    list: () => [SERVER],
    add: async () => {
      called = true;
      return SERVER;
    },
  }));

  assert.deepEqual(
    await handlers.add({ name: ' fixture ', command: 'node', args: [], cwd: null }),
    { ok: false, error: 'A global MCP server with that name already exists.' },
  );
  assert.equal(called, false);
});

test('workspace MCP names are unique within their workspace but may match global names', async () => {
  const added: McpServerDraft[] = [];
  const handlers = mcpHandlers(dependencies({
    list: () => [
      SERVER,
      ...added.map((draft, index) => ({ ...SERVER, ...draft, id: `workspace-server-${index}` })),
    ],
    workspaceExists: (id) => id === 'workspace-1',
    add: async (draft) => {
      added.push(draft);
      return SERVER;
    },
  }));
  const workspaceDraft = {
    scope: 'workspace',
    workspaceId: 'workspace-1',
    name: 'fixture',
    command: 'node',
    args: [],
    cwd: null,
  };

  assert.deepEqual(await handlers.add(workspaceDraft), { ok: true, value: SERVER });
  assert.equal(added[0]?.scope, 'workspace');
  assert.deepEqual(await handlers.add({ ...workspaceDraft }), {
    ok: false,
    error: 'A workspace MCP server with that name already exists.',
  });
  assert.deepEqual(await handlers.add({ ...workspaceDraft, workspaceId: 'missing' }), {
    ok: false,
    error: 'That MCP workspace does not exist.',
  });
});

test('credentials reach the main process but never return through MCP handlers', async () => {
  let received: McpServerDraft | undefined;
  const leaked = {
    ...SERVER,
    hasCredentials: true,
    credentials: { bearerToken: 'must-not-return' },
    env: { MCP_TOKEN: 'also-must-not-return' },
  } as unknown as McpServer;
  let listed: McpServer[] = [leaked];
  const handlers = mcpHandlers(dependencies({
    list: () => listed,
    add: async (draft) => {
      received = draft;
      return leaked;
    },
    update: async () => leaked,
  }));

  assert.deepEqual(await handlers.load(), { ok: true, value: [{ ...SERVER, hasCredentials: true }] });
  listed = [];
  const result = await handlers.add({
    name: 'fixture',
    transport: 'streamable-http',
    command: '',
    args: [],
    cwd: null,
    url: 'https://example.test/mcp',
    credentials: {
      headers: { 'x-key': 'header-secret' },
      bearerToken: 'bearer-secret',
    },
  });

  assert.equal(received?.credentials?.headers?.['x-key'], 'header-secret');
  assert.equal(received?.credentials?.bearerToken, 'bearer-secret');
  assert.deepEqual(result, { ok: true, value: { ...SERVER, hasCredentials: true } });
  assert.deepEqual(await handlers.update('server-1', {
    name: 'fixture', command: 'node', args: [], cwd: null,
  }), { ok: true, value: { ...SERVER, hasCredentials: true } });
});

interface InvalidCredentialCase {
  name: string;
  draft: unknown;
}

const INVALID_CREDENTIAL_CASES: InvalidCredentialCase[] = [
  {
    name: 'invalid environment variable name',
    draft: { name: 'fixture', command: 'node', args: [], cwd: null, credentials: { env: { 'NOT VALID': 'secret' } } },
  },
  {
    name: 'invalid HTTP header name',
    draft: {
      name: 'fixture', transport: 'streamable-http', command: '', args: [], cwd: null,
      url: 'https://example.test/mcp', credentials: { headers: { 'bad header': 'secret' } },
    },
  },
  {
    name: 'HTTP header value with a newline',
    draft: {
      name: 'fixture', transport: 'streamable-http', command: '', args: [], cwd: null,
      url: 'https://example.test/mcp', credentials: { headers: { 'x-key': 'line\r\nbreak' } },
    },
  },
  {
    name: 'non-string bearer token',
    draft: {
      name: 'fixture', transport: 'streamable-http', command: '', args: [], cwd: null,
      url: 'https://example.test/mcp', credentials: { bearerToken: 7 },
    },
  },
];

test('MCP handlers reject invalid credentials', async () => {
  for (const testCase of INVALID_CREDENTIAL_CASES) {
    let called = false;
    const handlers = mcpHandlers(dependencies({
      add: async () => {
        called = true;
        return SERVER;
      },
    }));

    assert.deepEqual(
      await handlers.add(testCase.draft),
      { ok: false, error: 'That is not a valid MCP server.' },
      testCase.name,
    );
    assert.equal(called, false, testCase.name);
  }
});

test('a URL draft is normalized and accepted', async () => {
  let added: McpServerDraft | undefined;
  const handlers = mcpHandlers(dependencies({
    add: async (draft) => {
      added = draft;
      return SERVER;
    },
  }));

  await handlers.add({
    name: 'remote',
    transport: 'streamable-http',
    url: ' https://example.test/mcp ',
    toolSelection: ['echo'],
  });
  assert.deepEqual(added, {
    scope: 'global',
    workspaceId: null,
    name: 'remote',
    transport: 'streamable-http',
    command: '',
    args: [],
    cwd: null,
    url: 'https://example.test/mcp',
    toolSelection: ['echo'],
  });
});

const OAUTH_HANDLER_CASES = [
  {
    name: 'signs in to a valid server id',
    action: 'signIn' as const,
    id: 'server-1',
    expected: { ok: true, value: null },
    forwarded: ['sign-in:server-1'],
  },
  {
    name: 'signs out of a valid server id',
    action: 'signOut' as const,
    id: 'server-1',
    expected: { ok: true, value: null },
    forwarded: ['sign-out:server-1'],
  },
  {
    name: 'refuses an invalid server id for sign-in',
    action: 'signIn' as const,
    id: '',
    expected: { ok: false, error: 'That MCP server does not exist.' },
    forwarded: [],
  },
  {
    name: 'refuses an invalid server id for sign-out',
    action: 'signOut' as const,
    id: '',
    expected: { ok: false, error: 'That MCP server does not exist.' },
    forwarded: [],
  },
] as const;

test('MCP OAuth handlers validate IDs and forward sign-in and sign-out', async (context) => {
  for (const testCase of OAUTH_HANDLER_CASES) {
    await context.test(testCase.name, async () => {
      const forwarded: string[] = [];
      const handlers = mcpHandlers(dependencies({
        signIn: async (id) => { forwarded.push(`sign-in:${id}`); },
        signOut: async (id) => { forwarded.push(`sign-out:${id}`); },
      }));
      const result = testCase.action === 'signIn'
        ? await handlers.signIn(testCase.id)
        : await handlers.signOut(testCase.id);
      assert.deepEqual(result, testCase.expected);
      assert.deepEqual(forwarded, testCase.forwarded);
    });
  }
});

for (const invalid of [
  null,
  {},
  { name: '', command: 'node', args: [], cwd: null },
  { name: 'fixture', command: '', args: [], cwd: null },
  { name: 'fixture', command: 'node', args: ['ok', 1], cwd: null },
  { name: 'fixture', command: 'node', args: [], cwd: 7 },
  { name: 'remote', transport: 'streamable-http', url: 'file:///tmp/mcp' },
]) {
  test(`an invalid MCP draft is refused: ${JSON.stringify(invalid)}`, async () => {
    let called = false;
    const handlers = mcpHandlers(dependencies({
      add: async () => {
        called = true;
        return SERVER;
      },
    }));

    assert.deepEqual(await handlers.add(invalid), {
      ok: false,
      error: 'That is not a valid MCP server.',
    });
    assert.equal(called, false);
  });
}

test('editing validates ids and duplicate names', async () => {
  const other = { ...SERVER, id: 'server-2', name: 'other' };
  const updated: string[] = [];
  const handlers = mcpHandlers(dependencies({
    list: () => [SERVER, other],
    update: async (id) => {
      updated.push(id);
      return SERVER;
    },
  }));

  assert.deepEqual(await handlers.update(null, SERVER), {
    ok: false,
    error: 'That MCP server does not exist.',
  });
  assert.deepEqual(await handlers.update('server-1', { ...SERVER, name: 'other' }), {
    ok: false,
    error: 'A global MCP server with that name already exists.',
  });
  assert.deepEqual(await handlers.update('server-1', { ...SERVER, name: 'updated' }), {
    ok: true,
    value: SERVER,
  });
  assert.deepEqual(updated, ['server-1']);
});

test('server controls validate and forward', async () => {
  const calls: string[] = [];
  const handlers = mcpHandlers(dependencies({
    reconnect: async (id) => { calls.push(`reconnect:${id}`); },
    setEnabled: async (id, enabled) => { calls.push(`enabled:${id}:${enabled}`); },
    setToolSelection: async (id, selection) => { calls.push(`tools:${id}:${JSON.stringify(selection)}`); },
  }));

  assert.deepEqual(await handlers.reconnect('server-1'), { ok: true, value: null });
  assert.deepEqual(await handlers.setEnabled('server-1', false), { ok: true, value: null });
  assert.deepEqual(await handlers.setToolSelection('server-1', ['echo', 'echo']), { ok: true, value: null });
  assert.deepEqual(await handlers.setToolSelection('server-1', ['']), {
    ok: false,
    error: 'That MCP tool selection is invalid.',
  });
  assert.deepEqual(calls, [
    'reconnect:server-1',
    'enabled:server-1:false',
    'tools:server-1:["echo"]',
  ]);
});

test('removing an MCP server validates the id and reports failures', async () => {
  let removed = '';
  const handlers = mcpHandlers(dependencies({
    remove: async (id) => {
      removed = id;
      throw new Error('the server was already gone');
    },
  }));

  assert.deepEqual(await handlers.remove(null), {
    ok: false,
    error: 'That MCP server does not exist.',
  });
  assert.deepEqual(await handlers.remove('server-1'), {
    ok: false,
    error: 'the server was already gone',
  });
  assert.equal(removed, 'server-1');
});
