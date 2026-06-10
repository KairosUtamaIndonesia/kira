import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

import { type Static, Type } from "typebox";

import { requestHumanInput } from "../human-in-the-loop";

const askUserSchema = Type.Object({
  question: Type.String({
    description: "The question to put to the user. Be specific and self-contained.",
  }),
  options: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional fixed choices to offer. Provide for a multiple-choice question; omit for a free-form answer.",
    }),
  ),
});

type AskUserInput = Static<typeof askUserSchema>;

/**
 * Builds the `ask_user` tool for one Agent Thread.
 *
 * The tool suspends the agent loop and surfaces the question to the desktop
 * Agent Thread as a tool call. The user's typed answer is delivered back through
 * the shared human-in-the-loop transport and returned to the model verbatim.
 */
export function createAskUserTool(threadId: string): AgentTool<typeof askUserSchema> {
  return {
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a question and wait for their answer. Use only when you are genuinely blocked on a decision the user alone can make: a material ambiguity, a missing requirement, or a risky choice. Resolve questions yourself from the workspace, files, and project conventions first. Provide `options` for a multiple-choice question; omit it for a free-form answer. Returns the user's answer.",
    parameters: askUserSchema,
    async execute(
      _toolCallId: string,
      params: AskUserInput,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ question: string }>> {
      const question = params.question;
      if (question.trim().length === 0) {
        throw new Error("ask_user requires a non-empty 'question'.");
      }

      const answer = await requestHumanInput<string>({
        threadId,
        signal,
        parseResponse: parseAskUserResponse,
      });
      return { content: [{ type: "text", text: answer }], details: { question } };
    },
  };
}

function parseAskUserResponse(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("ask_user response must be an object with an 'answer' string.");
  }
  const answer = (raw as Record<string, unknown>).answer;
  if (typeof answer !== "string" || answer.trim().length === 0) {
    throw new Error("ask_user response 'answer' must be a non-empty string.");
  }
  return answer;
}
