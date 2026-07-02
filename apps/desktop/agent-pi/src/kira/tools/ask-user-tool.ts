/**
 * ask-user-tool — asks the user structured questions via Pi's ctx.ui.
 *
 * Registers as a custom tool. When the model calls it, the questions are
 * rendered in the desktop UI through the extension UI protocol (the bridge
 * maps ctx.ui methods to WebSocket tool_ui_request events).
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const askUserSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String(),
      header: Type.String({ maxLength: 16 }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ maxLength: 60 }),
          description: Type.String(),
        }),
        { minItems: 2, maxItems: 4 },
      ),
      multiSelect: Type.Optional(Type.Boolean()),
    }),
    { minItems: 1, maxItems: 4 },
  ),
});

export const askUserTool = defineTool({
  name: "ask_user",
  label: "Ask User",
  description: "Ask the user structured questions when requirements are unclear.",
  parameters: askUserSchema,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const answers = await Promise.all(
      params.questions.map(async (q, i) => {
        const labels = q.options.map((o) => o.label);
        try {
          const selected = await ctx.ui.select(q.question, labels, {});
          if (selected === undefined) {
            return { questionIndex: i, cancelled: true, question: q.question };
          }
          return { questionIndex: i, answer: selected, question: q.question };
        } catch {
          return { questionIndex: i, cancelled: true, question: q.question };
        }
      }),
    );

    const cancelled = answers.some((a) => a.cancelled);
    if (cancelled) {
      return {
        content: [{ type: "text", text: "User declined to answer." }],
        details: { answers, cancelled },
      };
    }
    const text = answers.map((a) => `${a.question}="${a.answer}"`).join(". ");
    return {
      content: [{ type: "text", text: `User answered: ${text}` }],
      details: { answers, cancelled },
    };
  },
});
