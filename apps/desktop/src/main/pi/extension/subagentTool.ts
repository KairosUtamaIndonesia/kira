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

const PARAMETERS = Type.Object({
  role: Type.Union([Type.Literal('explore'), Type.Literal('general')], {
    description:
      'Which kind of child: explore reads and reports without changing anything; general may change files.',
  }),
  task: Type.String({
    description:
      'The bounded piece of work to delegate, written as a brief. The child starts from this alone, not from this chat.',
  }),
});

const DESCRIPTION =
  'Delegate a bounded piece of work to a subagent that runs beside this chat. Use explore to investigate (read-only) and general to change files. The child starts from the task alone, works in this chat’s folder, and its report arrives here as a message. Do not use this for work you can finish in this turn.';

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
      const childId = subagents.spawn({ role: params.role, prompt: params.task });

      return {
        content: [
          {
            type: 'text',
            text: `Delegated to a ${params.role} subagent (${childId}). It is working now, and its report will arrive in this chat as a message. Carry on with what you were doing, and read the report when it lands.`,
          },
        ],
        details: undefined,
      };
    },
  };
}
