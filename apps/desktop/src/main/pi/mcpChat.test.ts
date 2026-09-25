import { strict as assert } from 'node:assert';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ThreadStore } from '../db/threads.ts';
import { mcpManager } from '../mcp/servers.ts';
import { tempDir } from '../test-support/temp.ts';
import { startConversation } from './conversations.ts';
import { openChats } from './openChats.ts';
import { foundryModels } from './models.ts';

// Hermetic: booting pi must never read the developer's real credentials or config.
process.env['HOME'] = tempDir('foundry-mcp-chat-home-');
process.env['PI_CODING_AGENT_DIR'] = tempDir('foundry-mcp-chat-agent-');

function fixturePath({ waitForCall = false } = {}): {
  path: string;
  stopped: string;
  started: string;
  calling?: string;
  release?: string;
} {
  const folder = tempDir('foundry-mcp-chat-server-');
  const stopped = join(folder, 'stopped');
  const started = `${stopped}.started`;
  const calling = join(folder, 'calling');
  const release = join(folder, 'release');
  const path = join(folder, 'server.mjs');
  writeFileSync(
    path,
    `import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
const stopped = process.argv[2];
const calling = process.argv[3];
const release = process.argv[4];
const waitForCall = ${waitForCall ? 'true' : 'false'};
writeFileSync(stopped + '.started', 'yes');
const output = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
const input = createInterface({ input: process.stdin });
input.on('close', () => { writeFileSync(stopped, 'yes'); process.exit(0); });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') output(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } });
  else if (request.method === 'tools/list') output(request.id, { tools: [{ name: 'echo', description: 'Echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }] });
  else if (request.method === 'tools/call') {
    const answer = () => output(request.id, { content: [{ type: 'text', text: 'fixture: ' + request.params.arguments.message }] });
    if (!waitForCall) answer();
    else {
      writeFileSync(calling, 'yes');
      const waitForRelease = () => existsSync(release) ? answer() : setTimeout(waitForRelease, 10);
      waitForRelease();
    }
  }
});
process.on('SIGTERM', () => { writeFileSync(stopped, 'yes'); process.exit(0); });
`,
  );
  return waitForCall ? { path, stopped, started, calling, release } : { path, stopped, started };
}

function bodyOf(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function streamAnswer(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`);
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 5000) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('a real conversation calls a real stdio MCP tool and reads its result', async () => {
  const fixture = fixturePath();
  const requests: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    requests.push(body);
    providerCalls += 1;

    if (providerCalls === 1) {
      streamAnswer(response, {
        id: 'chatcmpl-tool-call',
        object: 'chat.completion.chunk',
        model: 'served-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'fixture_echo', arguments: '{"message":"hello"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
      return;
    }

    streamAnswer(response, {
      id: 'chatcmpl-final',
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'The MCP server said fixture: hello.' },
          finish_reason: 'stop',
        },
      ],
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(join(tempDir('foundry-mcp-chat-store-'), 'threads.db'));
  const saved = store.createMcpServer({
    name: 'fixture',
    command: process.execPath,
    args: [fixture.path, fixture.stopped],
    cwd: null,
  });
  const manager = mcpManager({ store });
  const cachePath = join(tempDir('foundry-mcp-chat-models-'), 'models.json');
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = foundryModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });

  let conversation: Awaited<ReturnType<typeof startConversation>> | undefined;
  try {
    await manager.start();
    await waitFor(() => manager.snapshot(saved.id)?.status === 'connected', 'the MCP fixture');
    conversation = await startConversation(
      store,
      tempDir('foundry-mcp-chat-space-'),
      models,
      {},
      undefined,
      undefined,
      manager,
    );

    await conversation.send('Please use the MCP echo tool.');

    const firstRequest = requests[0];
    assert.ok(firstRequest);
    assert.equal(
      (firstRequest.tools as Array<{ function: { name: string } }>).some(
        (tool) => tool.function.name === 'fixture_echo',
      ),
      true,
    );
    assert.equal(
      requests.some((request) =>
        (request.messages as Array<{ role: string }>).some((message) => message.role === 'tool'),
      ),
      true,
    );
    assert.equal(
      conversation
        .transcript()
        .messages.some((message) =>
          message.parts.some(
            (part) => part.type === 'text' && part.text.includes('fixture: hello'),
          ),
        ),
      true,
    );
  } finally {
    conversation?.close();
    await manager.close();
    await waitFor(
      () => existsSync(fixture.stopped) && readFileSync(fixture.stopped, 'utf8') === 'yes',
      'the MCP fixture to stop',
    );
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('two real workspace chats receive only their own MCP tools', async () => {
  const alphaFixture = fixturePath();
  const betaFixture = fixturePath();
  const requests: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  let turn = 0;
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    requests.push(body);
    providerCalls += 1;

    if (providerCalls % 2 === 1) {
      turn += 1;
      const name = turn === 1 ? 'alpha_echo' : 'beta_echo';
      streamAnswer(response, {
        id: `workspace-tool-${turn}`,
        object: 'chat.completion.chunk',
        model: 'served-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `workspace-call-${turn}`,
                  type: 'function',
                  function: { name, arguments: '{"message":"workspace"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
      return;
    }

    streamAnswer(response, {
      id: `workspace-final-${providerCalls}`,
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'workspace tool used' },
          finish_reason: 'stop',
        },
      ],
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(join(tempDir('foundry-mcp-workspaces-store-'), 'threads.db'));
  const alpha = store.rememberWorkspace(tempDir('foundry-mcp-workspace-alpha-'));
  const beta = store.rememberWorkspace(tempDir('foundry-mcp-workspace-beta-'));
  const alphaSaved = store.createMcpServer({
    scope: 'workspace',
    workspaceId: alpha.id,
    name: 'alpha',
    command: process.execPath,
    args: [alphaFixture.path, alphaFixture.stopped],
    cwd: null,
  });
  const betaSaved = store.createMcpServer({
    scope: 'workspace',
    workspaceId: beta.id,
    name: 'beta',
    command: process.execPath,
    args: [betaFixture.path, betaFixture.stopped],
    cwd: null,
  });
  const manager = mcpManager({ store });
  const cachePath = join(tempDir('foundry-mcp-workspaces-models-'), 'models.json');
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = foundryModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });
  let closeChats: (() => void) | undefined;

  try {
    await manager.start();
    let unpreparedChat: Awaited<ReturnType<typeof startConversation>> | undefined;
    let preparationError: unknown;
    try {
      unpreparedChat = await startConversation(
        store,
        alpha.folder,
        models,
        { workspaceId: alpha.id },
        undefined,
        undefined,
        manager,
      );
    } catch (error) {
      preparationError = error;
    } finally {
      unpreparedChat?.close();
    }
    assert.equal(
      (preparationError as Error | undefined)?.message,
      'Workspace MCP preparation is required for workspace chats.',
    );

    const chats = openChats(
      store,
      () => {},
      () => tempDir('foundry-mcp-workspace-new-'),
      models,
      undefined,
      undefined,
      manager,
      (workspaceId) => manager.connectWorkspace(workspaceId),
    );
    closeChats = () => chats.closeAll();

    await chats.start(alpha.id);
    await chats.send('Use the tool in this workspace.');
    await chats.start(beta.id);
    await chats.send('Use the tool in this workspace.');

    const names = (request: Record<string, unknown>) =>
      (request.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    assert.equal(names(requests[0]!).includes('alpha_echo'), true);
    assert.equal(names(requests[0]!).includes('beta_echo'), false);
    assert.equal(names(requests[2]!).includes('beta_echo'), true);
    assert.equal(names(requests[2]!).includes('alpha_echo'), false);
    assert.equal(manager.snapshot(alphaSaved.id)?.status, 'connected');
    assert.equal(manager.snapshot(betaSaved.id)?.status, 'connected');
  } finally {
    try {
      try {
        closeChats?.();
      } finally {
        try {
          await manager.close();
        } finally {
          if (existsSync(alphaFixture.started)) {
            await waitFor(
              () => existsSync(alphaFixture.stopped),
              'the alpha workspace MCP server to stop',
            );
          }
          if (existsSync(betaFixture.started)) {
            await waitFor(
              () => existsSync(betaFixture.stopped),
              'the beta workspace MCP server to stop',
            );
          }
        }
      }
    } finally {
      try {
        store.close();
      } finally {
        await new Promise<void>((resolve, reject) =>
          provider.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  }
});

test('a deselected MCP tool is absent on the next request', async () => {
  const fixture = fixturePath();
  const requests: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    requests.push(body);
    providerCalls += 1;
    const toolCall = {
      id: `chatcmpl-tool-${providerCalls}`,
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${providerCalls}`,
                type: 'function',
                function: { name: 'fixture_echo', arguments: '{"message":"stale"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const final = {
      id: `chatcmpl-final-${providerCalls}`,
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: providerCalls === 2 ? 'first done' : 'stale handled',
          },
          finish_reason: 'stop',
        },
      ],
    };
    streamAnswer(response, providerCalls === 1 || providerCalls === 3 ? toolCall : final);
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(join(tempDir('foundry-mcp-chat-stale-store-'), 'threads.db'));
  const saved = store.createMcpServer({
    name: 'fixture',
    command: process.execPath,
    args: [fixture.path, fixture.stopped],
    cwd: null,
  });
  const manager = mcpManager({ store });
  const cachePath = join(tempDir('foundry-mcp-chat-stale-models-'), 'models.json');
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = foundryModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });

  let conversation: Awaited<ReturnType<typeof startConversation>> | undefined;
  try {
    await manager.start();
    await waitFor(
      () => manager.snapshot(saved.id)?.status === 'connected',
      'the stale-call MCP fixture',
    );
    conversation = await startConversation(
      store,
      tempDir('foundry-mcp-chat-stale-space-'),
      models,
      {},
      undefined,
      undefined,
      manager,
    );

    await conversation.send('Use the MCP echo tool once.');
    await manager.setToolSelection(saved.id, []);
    await waitFor(() => manager.tools().length === 0, 'the MCP tool to deactivate');
    await conversation.send('Use the MCP echo tool again even though it is now disabled.');

    const disabledRequest = requests[2];
    assert.ok(disabledRequest);
    assert.equal(
      (disabledRequest.tools as Array<{ function: { name: string } }>).some(
        (tool) => tool.function.name === 'fixture_echo',
      ),
      false,
    );
    const transcript = JSON.stringify(conversation.transcript());
    assert.equal(transcript.includes('Tool fixture_echo not found'), true, transcript);
  } finally {
    conversation?.close();
    await manager.close();
    await waitFor(
      () => existsSync(fixture.stopped) && readFileSync(fixture.stopped, 'utf8') === 'yes',
      'the stale-call MCP fixture to stop',
    );
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('a stale in-flight MCP call answers server disconnected after deselecting its tool', async () => {
  const fixture = fixturePath({ waitForCall: true });
  const requests: Array<Record<string, unknown>> = [];
  let providerCalls = 0;
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    requests.push(body);
    providerCalls += 1;
    const bodyForCall = {
      id: 'stale-tool-call',
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'stale-call',
                type: 'function',
                function: { name: 'fixture_echo', arguments: '{"message":"stale"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const final = {
      id: 'stale-final',
      object: 'chat.completion.chunk',
      model: 'served-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'the stale call was handled' },
          finish_reason: 'stop',
        },
      ],
    };
    streamAnswer(response, providerCalls === 1 ? bodyForCall : final);
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (address === null || typeof address === 'string') throw new Error('the provider has no port');

  const store = new ThreadStore(join(tempDir('foundry-mcp-chat-in-flight-store-'), 'threads.db'));
  const saved = store.createMcpServer({
    name: 'fixture',
    command: process.execPath,
    args: [fixture.path, fixture.stopped, fixture.calling!, fixture.release!],
    cwd: null,
  });
  const manager = mcpManager({ store });
  const cachePath = join(tempDir('foundry-mcp-chat-in-flight-models-'), 'models.json');
  writeFileSync(
    cachePath,
    JSON.stringify({ models: [{ id: 'served-model', name: 'Served Model' }] }),
  );
  const models = foundryModels({
    server: `http://127.0.0.1:${address.port}`,
    cachePath,
    token: async () => 'device-key',
    catalog: async () => ({ kind: 'unavailable' as const }),
  });

  let conversation: Awaited<ReturnType<typeof startConversation>> | undefined;
  try {
    await manager.start();
    await waitFor(
      () => manager.snapshot(saved.id)?.status === 'connected',
      'the in-flight MCP fixture',
    );
    conversation = await startConversation(
      store,
      tempDir('foundry-mcp-chat-in-flight-space-'),
      models,
      {},
      undefined,
      undefined,
      manager,
    );
    const sending = conversation.send('Use the MCP echo tool.');
    await waitFor(() => existsSync(fixture.calling!), 'the MCP call to start');
    await manager.setToolSelection(saved.id, []);
    writeFileSync(fixture.release!, 'yes');
    await sending;

    const transcript = JSON.stringify(conversation.transcript());
    assert.equal(transcript.includes('server disconnected'), true, transcript);
  } finally {
    conversation?.close();
    await manager.close();
    await waitFor(
      () => existsSync(fixture.stopped) && readFileSync(fixture.stopped, 'utf8') === 'yes',
      'the in-flight MCP fixture to stop',
    );
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
