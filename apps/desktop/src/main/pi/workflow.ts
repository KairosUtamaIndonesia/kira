/**
 * The stage map Kira receives on every turn. Procedures remain in the bundled
 * skills; this keeps the prompt small while making the next useful stage clear.
 */
import type { ChatMode } from '../../preload/bridge.ts';

export const WORKFLOW_ROUTER = [
  'Workflow router: choose the skill that matches the work, and never ask the person to name one.',
  'A concrete feature or change: load to-spec. Let grilling handle the interview; when settled, call shape_spec_proposal and wait for the card. Answer questions, research requests and ordinary conversation directly.',
  'Clarify words and boundaries: domain-modeling.',
  'After an approved spec, a request to make tickets: load to-tickets and follow it; call shape_breakdown_proposal so Foundry shows the proposal card. Never claim approval, publication, or readiness unless Foundry state confirms it.',
  'An idea too large for one spec: wayfinder.',
  'A question ticket: grilling.',
  'A research run: research.',
  'A prototype run: prototype.',
  'A feature or refactor run: implement, with tdd and code-review.',
  'A bug run: diagnosing-bugs.',
  "A spec's own run: code-review against the spec.",
  'Resolve with Kira: resolving-merge-conflicts.',
].join('\n');

const SPEC_MODE_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'browser_open',
  'browser_snapshot',
  'browser_screenshot',
  'recall',
  'ask_user_question',
  'shape_spec_proposal',
  'propose_map',
  'propose_decision',
  'propose_outcome',
  'shape_breakdown_proposal',
  'tracker_queue',
  'tracker_read_ticket',
  'tracker_read_glossary',
  'tracker_read_decisions',
]);

/** The prompt and tool policy for the current chat mode. */
export function workflowForMode(mode: ChatMode): string {
  if (mode === 'build') return WORKFLOW_ROUTER;

  return [
    'Spec mode: planning-only interview and clarification. Do not change workspace files or start ticket runs.',
    'Explore with read-only tools, ask the person questions when needed, and propose a spec with shape_spec_proposal.',
    'After the person approves the spec, immediately call shape_breakdown_proposal to draft its tickets. Do not wait for another request.',
    'Wait for the person to approve the spec and ticket breakdown before Foundry publishes either one.',
  ].join('\n');
}

/** Whether a registered tool is permitted for the current chat mode. */
export function toolAllowedInMode(
  mode: ChatMode,
  toolName: string,
  mcpTools: readonly string[] = [],
): boolean {
  return mode === 'build' || (!mcpTools.includes(toolName) && SPEC_MODE_TOOLS.has(toolName));
}

/**
 * Active tools for one chat. Build retains its original set plus current MCP
 * tools; Spec uses an explicit read/planning allowlist and excludes every MCP
 * tool because those tools have no shared read-only contract.
 */
export function toolsForMode(
  mode: ChatMode,
  availableTools: readonly string[],
  mcpTools: readonly string[],
  knownMcpTools: readonly string[] = mcpTools,
): string[] {
  const currentMcp = new Set(mcpTools);
  const allMcp = new Set(knownMcpTools);
  if (mode === 'build') {
    return availableTools.filter((name) => !allMcp.has(name) || currentMcp.has(name));
  }
  return availableTools.filter((name) => !allMcp.has(name) && toolAllowedInMode('spec', name));
}
