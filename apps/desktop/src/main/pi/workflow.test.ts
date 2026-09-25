import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBashToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ThreadStore } from '../db/threads.ts';
import { kiraExtension } from './extension/factory.ts';
import { WORKFLOW_ROUTER } from './workflow.ts';

function registered(
  tracker = false,
  mode: 'build' | 'spec' = 'build',
  mcpTools: string[] = [],
  getShellPath?: () => string | undefined,
): {
  before: (event: { systemPrompt: string }) => { systemPrompt: string };
  toolCall: (event: { toolName: string; input: Record<string, unknown> }) => unknown;
  tools: string[];
  activeTools: () => string[];
  close: () => void;
} {
  let beforeHandler: ((event: { systemPrompt: string }) => { systemPrompt: string }) | undefined;
  let toolCallHandler:
    | ((event: { toolName: string; input: Record<string, unknown> }) => unknown)
    | undefined;
  const tools: string[] = [];
  let activeTools = ['read', 'bash', 'edit', 'write'];
  const store = new ThreadStore(join(mkdtempSync(join(tmpdir(), 'kira-router-')), 'threads.db'));
  store.createThread(tmpdir(), { id: 'thread-1', mode });
  const definition = kiraExtension({
    cwd: tmpdir(),
    store,
    threadId: 'thread-1',
    models: {} as never,
    getShellPath,
    tracker: tracker ? ({} as never) : undefined,
    mcp:
      mcpTools.length === 0
        ? undefined
        : ({
            tools: () =>
              mcpTools.map((name) => ({
                name,
                description: 'MCP tool',
                inputSchema: {},
              })),
            subscribe: () => () => {},
          } as never),
  });

  definition.factory({
    on(name: string, handler: unknown) {
      if (name === 'before_agent_start' || name === 'tool_call') {
        if (name === 'before_agent_start') {
          beforeHandler = handler as (event: { systemPrompt: string }) => { systemPrompt: string };
        } else {
          toolCallHandler = handler as (event: {
            toolName: string;
            input: Record<string, unknown>;
          }) => unknown;
        }
      }
      return () => {};
    },
    registerTool(tool: { name: string }) {
      tools.push(tool.name);
    },
    getAllTools: () => [
      ...['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'].map((name) => ({ name })),
      ...tools.map((name) => ({ name })),
    ],
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
  } as unknown as ExtensionAPI);

  const before = beforeHandler;
  const toolCall = toolCallHandler;
  assert.ok(before);
  assert.ok(toolCall);
  return {
    before,
    toolCall,
    tools,
    activeTools: () => activeTools,
    close: () => store.close(),
  };
}

test('the workflow router is appended to every system prompt', () => {
  const { before, close } = registered();
  try {
    assert.equal(before({ systemPrompt: 'base' }).systemPrompt, `base\n\n${WORKFLOW_ROUTER}`);
    assert.equal(
      before({ systemPrompt: 'next turn' }).systemPrompt,
      `next turn\n\n${WORKFLOW_ROUTER}`,
    );
    for (const skill of [
      'router',
      'grilling',
      'domain-modeling',
      'to-spec',
      'to-tickets',
      'wayfinder',
      'research',
      'prototype',
      'implement',
      'diagnosing-bugs',
      'resolving-merge-conflicts',
    ]) {
      assert.match(WORKFLOW_ROUTER, new RegExp(skill));
    }
    assert.match(
      WORKFLOW_ROUTER,
      /After an approved spec, a request to make tickets: load to-tickets/,
    );
    assert.match(WORKFLOW_ROUTER, /call shape_breakdown_proposal/);
    assert.match(
      WORKFLOW_ROUTER,
      /Never claim approval, publication, or readiness unless Kira state confirms it/,
    );
  } finally {
    close();
  }
});

test('Spec mode exposes planning tools and blocks workspace changes', () => {
  const { before, toolCall, activeTools, close } = registered(false, 'spec');
  try {
    const prompt = before({ systemPrompt: 'base' }).systemPrompt;
    assert.match(prompt, /planning-only/);
    assert.ok(activeTools().includes('read'));
    assert.ok(activeTools().includes('shape_spec_proposal'));
    assert.ok(activeTools().includes('shape_breakdown_proposal'));
    assert.ok(!activeTools().includes('write'));
    assert.ok(!activeTools().includes('bash'));
    assert.deepEqual(toolCall({ toolName: 'write', input: { path: 'src/main.ts' } }), {
      block: true,
      reason: 'Spec mode is planning-only. Switch to Build mode before using this tool.',
    });
    assert.equal(toolCall({ toolName: 'shape_spec_proposal', input: {} }), undefined);
  } finally {
    close();
  }
});

test('Spec mode blocks MCP tools even when their names are on the allowlist', () => {
  const { toolCall, activeTools, close } = registered(false, 'spec', ['tracker_read_ticket']);
  try {
    assert.ok(!activeTools().includes('tracker_read_ticket'));
    assert.deepEqual(toolCall({ toolName: 'tracker_read_ticket', input: {} }), {
      block: true,
      reason: 'Spec mode is planning-only. Switch to Build mode before using this tool.',
    });
  } finally {
    close();
  }
});

test(
  'Bash commands report the selected executable in SHELL',
  { skip: process.platform === 'win32' },
  async () => {
    const { toolCall, close } = registered(false, 'build', [], () => '/bin/sh');
    const event = {
      toolName: 'bash',
      input: { command: 'printf "%s\\n%s" "$0" "$SHELL"' },
    };
    try {
      assert.equal(toolCall(event), undefined);
      const bash = createBashToolDefinition(tmpdir(), { shellPath: '/bin/sh' });
      const result = await bash.execute(
        'shell-environment-test',
        event.input,
        undefined,
        undefined,
        undefined as never,
      );
      const output = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      assert.equal(output, '/bin/sh\n/bin/sh');
    } finally {
      close();
    }
  },
);

test('tracker tools are registered alongside the ordinary extension tools', () => {
  const { tools, close } = registered(true);
  try {
    assert.deepEqual(tools, [
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
      'tracker_queue',
      'tracker_read_ticket',
      'tracker_read_glossary',
      'tracker_read_decisions',
      'tracker_update_glossary',
      'tracker_write_draft',
      'tracker_edit_draft',
    ]);
    assert.ok(!tools.some((name) => /publish|ready|approve/i.test(name)));
  } finally {
    close();
  }
});
