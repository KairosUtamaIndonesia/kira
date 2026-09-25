import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ThreadStore } from '../../db/threads.ts';
import type { McpManager, McpToolBinding } from '../../mcp/servers.ts';
import { kiraExtension } from './factory.ts';

const TOOL: McpToolBinding = {
  name: 'fixture_echo',
  serverId: 'server-1',
  serverName: 'fixture',
  toolName: 'echo',
  description: 'Echo a message',
  selected: true,
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
};

test('the Kira extension exposes app-level MCP tools and forwards calls', async () => {
  let changed: (() => void) | undefined;
  let callToolResult: {
    content: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    >;
    isError?: boolean;
  } = { content: [{ type: 'text', text: 'fixture: hello' }] };
  const manager = {
    tools: () => [TOOL],
    subscribe: (listener: () => void) => {
      changed = listener;
      return () => undefined;
    },
    callTool: async () => callToolResult,
  } as unknown as McpManager;
  const registered: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> = [];
  let active = ['read'];
  const pi = {
    on: () => undefined,
    registerTool: (tool: (typeof registered)[number]) => registered.push(tool),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    refreshTools: () => undefined,
  } as unknown as ExtensionAPI;
  const store = new ThreadStore(':memory:');
  store.createThread('/tmp', { id: 'thread-1' });

  kiraExtension({
    cwd: '/tmp',
    store,
    threadId: 'thread-1',
    models: {} as never,
    mcp: manager,
  }).factory(pi);
  changed?.();

  assert.deepEqual(
    registered.map((tool) => tool.name),
    [
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'recall',
      'shape_spec_proposal',
      'propose_map',
      'propose_decision',
      'propose_outcome',
      'shape_breakdown_proposal',
      'fixture_echo',
    ],
  );
  assert.deepEqual(active, ['read', 'fixture_echo']);

  const fixtureTool = registered.find((tool) => tool.name === 'fixture_echo');
  assert.ok(fixtureTool);
  const result = await fixtureTool.execute(
    'call-1',
    { message: 'hello' },
    undefined,
    undefined,
    {},
  );
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'fixture: hello' }],
    details: undefined,
  });

  callToolResult = {
    content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
  };
  assert.deepEqual(
    await fixtureTool.execute('call-2', { message: 'image' }, undefined, undefined, {}),
    {
      content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      details: undefined,
    },
  );

  callToolResult = { content: [{ type: 'text', text: 'MCP failed' }], isError: true };
  await assert.rejects(
    fixtureTool.execute('call-3', { message: 'error' }, undefined, undefined, {}),
    /MCP failed/,
  );

  // A later manager update removes the active tool without trying to unregister
  // the definition, which Pi 0.85.1 cannot do.
  (manager.tools as () => McpToolBinding[]) = () => [];
  changed?.();
  assert.deepEqual(active, ['read']);
  store.close();
});
