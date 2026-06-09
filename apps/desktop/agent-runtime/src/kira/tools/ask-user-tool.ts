import { defineTool, Type, type ToolDefinition } from "@flue/runtime";

import { requestHumanInput } from "../human-in-the-loop";

const askUserParameters = Type.Object({
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

/**
 * Builds the `ask_user` tool for one Agent Thread.
 *
 * The tool suspends the agent loop and surfaces the question to the desktop
 * Agent Thread as a tool call. The user's typed answer is delivered back through
 * the shared human-in-the-loop transport and returned to the model verbatim.
 */
function createAskUserTool(threadId: string): ToolDefinition {
  return defineTool({
    name: "ask_user",
    description:
      "Ask the user a question and wait for their answer. Use only when you are genuinely blocked on a decision the user alone can make: a material ambiguity, a missing requirement, or a risky choice. Resolve questions yourself from the workspace, files, and project conventions first. Provide `options` for a multiple-choice question; omit it for a free-form answer. Returns the user's answer.",
    parameters: askUserParameters,
    async execute(args, signal) {
      const question = args.question;
      if (typeof question !== "string" || question.trim().length === 0) {
        throw new Error("ask_user requires a non-empty 'question'.");
      }

      return await requestHumanInput<string>({
        threadId,
        signal,
        parseResponse: parseAskUserResponse,
      });
    },
  });
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

export { createAskUserTool };
