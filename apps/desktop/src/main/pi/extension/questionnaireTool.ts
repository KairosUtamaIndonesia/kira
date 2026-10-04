import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import type { QuestionnaireParams } from '../../../preload/bridge.ts';
import type { Questionnaires } from '../../questionnaires.ts';
import {
  questionnaireResponse,
  questionnaireSchema,
  validateQuestionnaire,
  type QuestionnaireInput,
} from '../../questionnaires.ts';

export const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

const DESCRIPTION =
  'Ask the user up to four structured questions while you work. Use this when you need a concrete decision or requirement before proceeding. Group related questions into one call. Each question needs two to four distinct options with concise labels and descriptions. Use multiSelect when choices are not mutually exclusive; option previews can compare concrete artifacts. The user can type a custom answer, add notes, submit partial answers, or cancel. Do not guess when the answer materially changes the work.';

export function questionnaireTool(
  questionnaires: Questionnaires,
  threadId: string,
  beforeAsk?: () => void,
  afterAnswer?: () => void,
  askParent?: (question: string) => Promise<string | null>,
) {
  return {
    name: ASK_USER_QUESTION_TOOL_NAME,
    label: 'Ask the user',
    description: DESCRIPTION,
    promptSnippet:
      'Ask the user structured questions when requirements are ambiguous and a decision changes the work.',
    promptGuidelines: [
      'Use ask_user_question when you need the user to choose before proceeding; group related questions in one call.',
      'Ask one to four questions, with two to four options each. Explain trade-offs in option descriptions.',
      'Set multiSelect when choices can be combined. Add previews only when comparing concrete artifacts.',
      'The user can answer in their own words, attach notes, submit partial answers, or cancel.',
    ],
    parameters: questionnaireSchema,
    async execute(
      _toolCallId: string,
      rawParams: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> {
      const params = rawParams as unknown as QuestionnaireInput;
      const invalid = validateQuestionnaire(params);
      if (invalid !== null) {
        return {
          content: [{ type: 'text', text: `Error: ${invalid}` }],
          details: undefined,
        };
      }

      beforeAsk?.();
      const question = params.questions
        .map(
          ({ question, options }) =>
            `${question}\n${options.map(({ label, description }) => `- ${label}: ${description}`).join('\n')}`,
        )
        .join('\n\n');
      let answer: string | null = null;
      try {
        answer = (await askParent?.(question)) ?? null;
      } catch {
        // Kira may be in a turn already; the existing questionnaire is the fallback.
      }
      if (
        answer !== null &&
        answer.trim() !== '' &&
        !/\b(?:i cannot|i can't|i don’t know|i don't know|not enough context)\b/i.test(answer)
      ) {
        afterAnswer?.();
        return {
          content: [
            {
              type: 'text',
              text: `Kira answered your question:\n${answer}\nContinue with Kira's answer in mind.`,
            },
          ],
          details: undefined,
        };
      }
      const result = await questionnaires.ask(threadId, params as QuestionnaireParams, signal);
      afterAnswer?.();
      return {
        content: [{ type: 'text', text: questionnaireResponse(result) }],
        details: result as never,
      };
    },
  };
}
