/**
 * Kira's delegation tool.
 *
 * A subagent is a child agent of this chat (ADR 0028): Kira delegates a bounded
 * piece of work to a role — an investigator that may only read, or a general one
 * that may change the work — and the child runs beside the conversation. It does
 * not report here: the work outlives this call, so the tool answers with the
 * child's id, and the chat carries the report as a message when it arrives.
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SubagentManager } from '../subagents.ts';

export const SUBAGENT_TOOL_NAME = 'subagent';

const PARAMETERS = Type.Union([
  Type.Object({
    action: Type.Literal('spawn'),
    role: Type.Union([Type.Literal('explore'), Type.Literal('general')]),
    task: Type.String(),
  }),
  Type.Object({ action: Type.Literal('result'), childId: Type.String() }),
  Type.Object({ action: Type.Literal('steer'), childId: Type.String(), message: Type.String() }),
  Type.Object({ action: Type.Literal('stop'), childId: Type.String() }),
  Type.Object({ action: Type.Literal('resume'), childId: Type.String(), task: Type.String() }),
]);

const DESCRIPTION =
  'Manage a subagent beside this chat: spawn a bounded task, fetch a child result, steer or stop a running child, or resume a settled child. Use explore to investigate read-only and general to change files. Children start from their task alone and report back here.';

export function subagentTool(subagents: SubagentManager): ToolDefinition<typeof PARAMETERS> {
  return {
    name: SUBAGENT_TOOL_NAME,
    label: 'Delegate work',
    description: DESCRIPTION,
    promptSnippet:
      'Delegate a bounded, self-contained piece of work to a subagent that runs beside the chat.',
    parameters: PARAMETERS,
    executionMode: 'parallel',

    async execute(_id, params) {
      if (params.action === 'spawn') {
        const childId = subagents.spawn({ role: params.role, prompt: params.task });
        return result(
          `Delegated to a ${params.role} subagent (${childId}). It is working now, and its report will arrive in this chat as a message.`,
        );
      }
      if (params.action === 'result') {
        const child = subagents.list().find(({ id }) => id === params.childId);
        if (child === undefined) throw new Error('That subagent does not belong to this chat.');
        return result(JSON.stringify(child));
      }
      if (params.action === 'steer') {
        await subagents.steer(params.childId, params.message);
        return result(`Steered subagent ${params.childId}.`);
      }
      if (params.action === 'stop') {
        await subagents.stop(params.childId);
        return result(`Stopped subagent ${params.childId}.`);
      }
      await subagents.resume(params.childId, params.task);
      return result(`Resumed subagent ${params.childId}.`);
    },
  };
}

function result(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}
