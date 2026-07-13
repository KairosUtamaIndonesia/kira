import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { type Static, Type } from "typebox";

import type { ToolUiBroker, ToolUiRequestInput } from "../tool-ui-broker";

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 16;
const MAX_LABEL_LENGTH = 60;
const RESERVED_LABELS = ["Other", "Type something.", "Chat about this", "Next"] as const;

const askUserOptionSchema = Type.Object({
  label: Type.String({
    maxLength: MAX_LABEL_LENGTH,
    description:
      "Concise display text for this option. Use 1-5 words and make the choice distinct.",
  }),
  description: Type.String({
    description: "Explanation of what this option means or what trade-offs it carries.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional markdown preview for choices that need richer side-by-side context, such as mockups, code snippets, diagrams, or configuration examples.",
    }),
  ),
});

const askUserQuestionSchema = Type.Object({
  question: Type.String({
    description:
      "The complete question to ask the user. Be clear, specific, and end with a question mark.",
  }),
  header: Type.String({
    maxLength: MAX_HEADER_LENGTH,
    description: 'Very short chip shown next to the question. Examples: "Auth method", "Library".',
  }),
  options: Type.Array(askUserOptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: "Available choices for this question. Provide 2-4 options.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      description: "Set to true when multiple answers are valid.",
    }),
  ),
});

const askUserSchema = Type.Object({
  questions: Type.Array(askUserQuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: "Questions to ask the user. Ask 1-4 questions in one invocation.",
  }),
});

type AskUserInput = Static<typeof askUserSchema>;
type AskUserQuestion = AskUserInput["questions"][number];
type AskUserAnswer = {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "chat" | "multi";
  answer?: string | undefined;
  selected?: string[] | undefined;
  notes?: string | undefined;
  preview?: string | undefined;
};
type AskUserResult = {
  answers: AskUserAnswer[];
  cancelled: boolean;
  error?: string | undefined;
};

/**
 * Builds the `ask_user` tool for one Agent Thread.
 *
 * The tool suspends the agent loop and asks the active desktop Agent Thread
 * socket to render a small structured questionnaire. The user's answers resolve
 * the tool and are returned to the model in a compact envelope.
 */
export function createAskUserTool(
  toolUiBroker: ToolUiBroker,
): ToolDefinition<typeof askUserSchema> {
  return {
    name: "ask_user",
    label: "Ask User",
    description: `Ask the user one or more structured questions and wait for their answers. Use when the request is underspecified and you cannot proceed without concrete decisions.

Usage notes:
- Ask 1-${MAX_QUESTIONS} questions per invocation; group related clarifications instead of calling this tool repeatedly.
- Each question must have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option needs a concise label and a description explaining the choice.
- Use multiSelect: true when multiple answers are valid.
- If you recommend a specific option, make it the first option and append "(Recommended)" to its label.
- Use option.preview only when the user benefits from richer markdown context, such as mockups, code snippets, diagrams, or configuration examples.
- Do not author "Other", "Type something.", "Chat about this", or "Next" as options. The UI adds sentinel rows for custom text, chat, and multi-select confirmation.`,
    parameters: askUserSchema,
    async execute(
      toolCallId: string,
      params: AskUserInput,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<AskUserResult>> {
      validateAskUserInput(params);

      const result = await toolUiBroker.request<AskUserResult>({
        toolCallId,
        toolName: "ask_user",
        input: params as ToolUiRequestInput,
        signal,
        parseResponse: (raw) => parseAskUserResponse(raw, params),
      });
      return buildAskUserResponse(result, params);
    },
  };
}

function validateAskUserInput(params: AskUserInput): void {
  if (params.questions.length === 0) {
    throw new Error("ask_user requires at least one question.");
  }
  if (params.questions.length > MAX_QUESTIONS) {
    throw new Error(`ask_user accepts at most ${MAX_QUESTIONS} questions.`);
  }

  const seenQuestions = new Set<string>();
  for (const question of params.questions) {
    const trimmedQuestion = question.question.trim();
    if (trimmedQuestion.length === 0) {
      throw new Error("ask_user questions must be non-empty.");
    }
    if (seenQuestions.has(trimmedQuestion)) {
      throw new Error("ask_user question text must be unique within an invocation.");
    }
    seenQuestions.add(trimmedQuestion);
    validateQuestionOptions(question);
  }
}

function validateQuestionOptions(question: AskUserQuestion): void {
  if (question.options.length < MIN_OPTIONS) {
    throw new Error(`ask_user questions require at least ${MIN_OPTIONS} options.`);
  }
  if (question.options.length > MAX_OPTIONS) {
    throw new Error(`ask_user questions accept at most ${MAX_OPTIONS} options.`);
  }

  const seenLabels = new Set<string>();
  for (const option of question.options) {
    const label = option.label.trim();
    if (label.length === 0) {
      throw new Error("ask_user option labels must be non-empty.");
    }
    if (RESERVED_LABELS.some((reservedLabel) => reservedLabel === label)) {
      throw new Error(`ask_user option label is reserved (${RESERVED_LABELS.join(", ")}).`);
    }
    if (seenLabels.has(label)) {
      throw new Error("ask_user option labels must be unique within a question.");
    }
    seenLabels.add(label);
  }
}

function parseAskUserResponse(raw: unknown, params: AskUserInput): AskUserResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("ask_user response must be an object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.cancelled === true) {
    return { answers: [], cancelled: true };
  }
  if (!Array.isArray(record.answers)) {
    throw new Error("ask_user response must include an 'answers' array.");
  }

  const answers = record.answers.map((answer) => parseAnswer(answer, params));
  return { answers, cancelled: false };
}

function parseAnswer(raw: unknown, params: AskUserInput): AskUserAnswer {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("ask_user answer must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const questionIndex = record.questionIndex;
  if (!Number.isInteger(questionIndex)) {
    throw new Error("ask_user answer requires an integer questionIndex.");
  }
  const index = questionIndex as number;
  const question = params.questions[index];
  if (question === undefined) {
    throw new Error("ask_user answer questionIndex is out of range.");
  }

  const kind = parseAnswerKind(record.kind);
  switch (kind) {
    case "chat":
      return {
        questionIndex: index,
        question: question.question,
        kind,
        answer: "Chat about this",
      };
    case "custom":
      return {
        questionIndex: index,
        question: question.question,
        kind,
        answer: parseCustomAnswer(record.answer),
      };
    case "multi":
      return {
        questionIndex: index,
        question: question.question,
        kind,
        selected: parseSelectedLabels(record, question),
      };
    case "option":
      return parseOptionAnswer(index, record, question);
    default:
      return exhaustiveAnswerKind(kind);
  }
}

function parseOptionAnswer(
  index: number,
  record: Record<string, unknown>,
  question: AskUserQuestion,
): AskUserAnswer {
  const selected = parseSelectedLabels(record, question);
  const answer = selected[0];
  if (answer === undefined) {
    throw new Error("ask_user single-select answer requires one selected label.");
  }
  const option = question.options.find((candidate) => candidate.label === answer);
  return {
    questionIndex: index,
    question: question.question,
    kind: "option",
    answer,
    preview: option === undefined ? undefined : option.preview,
  };
}

function parseAnswerKind(raw: unknown): AskUserAnswer["kind"] {
  switch (raw) {
    case "option":
    case "custom":
    case "chat":
    case "multi":
      return raw;
    default:
      throw new Error("ask_user answer requires a valid kind.");
  }
}

function parseCustomAnswer(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("ask_user custom answer must be a non-empty string.");
  }
  return raw;
}

function exhaustiveAnswerKind(kind: never): never {
  throw new Error(`Unhandled ask_user answer kind: ${kind}`);
}

function parseSelectedLabels(record: Record<string, unknown>, question: AskUserQuestion): string[] {
  const selected = record.selected;
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new Error("ask_user answer requires at least one selected option.");
  }
  const labels = selected.map((label) => {
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error("ask_user selected option labels must be non-empty strings.");
    }
    return label;
  });
  for (const label of labels) {
    if (!question.options.some((option) => option.label === label)) {
      throw new Error(`ask_user selected unknown option '${label}'.`);
    }
  }
  return labels;
}

function buildAskUserResponse(
  result: AskUserResult,
  params: AskUserInput,
): AgentToolResult<AskUserResult> {
  if (result.cancelled || result.answers.length === 0) {
    return {
      content: [{ type: "text", text: "User declined to answer questions" }],
      details: { answers: result.answers, cancelled: true },
    };
  }

  const segments = params.questions
    .map((_question, index) => result.answers.find((answer) => answer.questionIndex === index))
    .filter((answer): answer is AskUserAnswer => answer !== undefined)
    .map(answerSegment);

  return {
    content: [
      {
        type: "text",
        text: `User has answered your questions: ${segments.join(" ")} You can now continue with the user's answers in mind.`,
      },
    ],
    details: result,
  };
}

function answerSegment(answer: AskUserAnswer): string {
  const scalar = answer.kind === "multi" ? selectedAnswerText(answer) : answer.answer;
  const parts = [`"${answer.question}"="${scalar ?? "(no input)"}"`];
  if (answer.preview !== undefined && answer.preview.length > 0) {
    parts.push(`selected preview: ${answer.preview}`);
  }
  if (answer.notes !== undefined && answer.notes.length > 0) {
    parts.push(`user notes: ${answer.notes}`);
  }
  return `${parts.join(". ")}.`;
}

function selectedAnswerText(answer: AskUserAnswer): string | undefined {
  if (answer.selected === undefined) {
    return;
  }
  return answer.selected.join(", ");
}
