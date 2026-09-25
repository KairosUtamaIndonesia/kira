import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toolAllowedInMode, toolsForMode, workflowForMode } from './workflow.ts';

test('each chat mode exposes its tools and blocks MCP name collisions', () => {
  const cases = [
    {
      name: 'Spec keeps read and planning tools, not writes or MCP tools',
      mode: 'spec' as const,
      available: [
        'read',
        'bash',
        'edit',
        'write',
        'grep',
        'find',
        'ls',
        'browser_open',
        'browser_click',
        'shape_spec_proposal',
        'shape_breakdown_proposal',
        'tracker_queue',
        'tracker_write_draft',
        'tracker_read_ticket',
        'workspace_search',
        'old_mcp_tool',
      ],
      mcpTools: ['workspace_search', 'old_mcp_tool', 'tracker_read_ticket'],
      knownMcpTools: ['workspace_search', 'old_mcp_tool', 'tracker_read_ticket'],
      toolName: 'tracker_read_ticket',
      expectedTools: [
        'read',
        'grep',
        'find',
        'ls',
        'browser_open',
        'shape_spec_proposal',
        'shape_breakdown_proposal',
        'tracker_queue',
      ],
      expectedAllowed: false,
    },
    {
      name: 'Build retains ordinary tools and current MCP tools, not stale MCP tools',
      mode: 'build' as const,
      available: [
        'read',
        'bash',
        'edit',
        'write',
        'shape_spec_proposal',
        'workspace_search',
        'old_mcp_tool',
      ],
      mcpTools: ['workspace_search'],
      knownMcpTools: ['workspace_search', 'old_mcp_tool'],
      toolName: 'tracker_read_ticket',
      expectedTools: ['read', 'bash', 'edit', 'write', 'shape_spec_proposal', 'workspace_search'],
      expectedAllowed: true,
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      toolsForMode(testCase.mode, testCase.available, testCase.mcpTools, testCase.knownMcpTools),
      testCase.expectedTools,
      testCase.name,
    );
    assert.equal(
      toolAllowedInMode(testCase.mode, testCase.toolName, testCase.mcpTools),
      testCase.expectedAllowed,
      testCase.name,
    );
  }
});

test('Spec mode instructs Kira to draft the breakdown after spec approval', () => {
  const prompt = workflowForMode('spec');
  assert.match(prompt, /planning-only/);
  assert.match(prompt, /shape_spec_proposal/);
  assert.match(
    prompt,
    /After the person approves the spec, immediately call shape_breakdown_proposal/,
  );
  assert.match(prompt, /Do not change workspace files/);
});
