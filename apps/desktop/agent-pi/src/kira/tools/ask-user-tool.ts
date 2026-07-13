/**
 * ask-user-tool — asks the user structured questions via Pi's ctx.ui.
 *
 * Full-featured tool matching the rpiv-ask-user-question extension.
 * Uses sequential RPC fallback: each question is asked one at a time
 * via ctx.ui.select() / ctx.ui.input() over the WebSocket bridge.
 *
 * Supported: single-select with "Type something." free-text fallback,
 * multi-select via comma-separated indices, option preview, per-option
 * descriptions, duplicate/reserved-label validation.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

// ── Constants ──────────────────────────────────────────────────────────

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 16;
const MAX_LABEL_LENGTH = 60;

const RESERVED_LABELS = ["Other", "Type something.", "Next ->"] as const;

const DECLINE_MESSAGE = "User declined to answer questions";
const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
const NO_INPUT_PLACEHOLDER = "(no input)";
const OTHER_SENTINEL = "Type something.";
const CUSTOM_ANSWER_PROMPT = "Type your answer:";

// ── Schema ─────────────────────────────────────────────────────────────

const OptionSchema = Type.Object({
  label: Type.String({ maxLength: MAX_LABEL_LENGTH }),
  description: Type.String(),
  preview: Type.Optional(Type.String()),
});

const QuestionSchema = Type.Object({
  question: Type.String(),
  header: Type.String({ maxLength: MAX_HEADER_LENGTH }),
  options: Type.Array(OptionSchema, { minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS }),
  multiSelect: Type.Optional(Type.Boolean()),
});

const askUserSchema = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
});

type OptionData = Static<typeof OptionSchema>;
type QuestionData = Static<typeof QuestionSchema>;

// ── Result types ───────────────────────────────────────────────────────

interface QuestionAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "multi";
  answer: string | undefined;
  selected?: string[];
  preview: string | undefined;
}

// ── Validation ─────────────────────────────────────────────────────────

type ValidationOk = { ok: true };
type ValidationErr = { ok: false; error: string; message: string };
type ValidationResult = ValidationOk | ValidationErr;

function validateQuestionnaire(params: unknown): ValidationResult {
  if (!params || typeof params !== "object") {
    return { ok: false, error: "no_questions", message: "At least one question is required" };
  }
  if (!("questions" in params)) {
    return { ok: false, error: "no_questions", message: "At least one question is required" };
  }
  const rawQuestions = params.questions;
  if (!Array.isArray(rawQuestions)) {
    return { ok: false, error: "no_questions", message: "At least one question is required" };
  }
  if (rawQuestions.length === 0) {
    return { ok: false, error: "no_questions", message: "At least one question is required" };
  }
  if (rawQuestions.length > MAX_QUESTIONS) {
    return {
      ok: false,
      error: "too_many_questions",
      message: "At most " + MAX_QUESTIONS + " questions are allowed per invocation",
    };
  }

  const seenQuestions = new Set<string>();
  for (const rawQ of rawQuestions) {
    if (!rawQ || typeof rawQ !== "object") {
      return {
        ok: false,
        error: "empty_options",
        message: "Each question requires at least " + MIN_OPTIONS + " options",
      };
    }
    const qText = "question" in rawQ && typeof rawQ.question === "string" ? rawQ.question : "";
    if (seenQuestions.has(qText)) {
      return {
        ok: false,
        error: "duplicate_question",
        message: "Question text must be unique within an invocation",
      };
    }
    seenQuestions.add(qText);

    const rawOptions = "options" in rawQ ? rawQ.options : undefined;
    if (!Array.isArray(rawOptions) || rawOptions.length < MIN_OPTIONS) {
      return {
        ok: false,
        error: "empty_options",
        message: "Each question requires at least " + MIN_OPTIONS + " options",
      };
    }

    const seenLabels = new Set<string>();
    for (const rawO of rawOptions) {
      if (!rawO || typeof rawO !== "object") {
        return {
          ok: false,
          error: "empty_options",
          message: "Each question requires at least " + MIN_OPTIONS + " options",
        };
      }
      const label = "label" in rawO && typeof rawO.label === "string" ? rawO.label : "";
      if (RESERVED_LABELS.includes(label as (typeof RESERVED_LABELS)[number])) {
        return {
          ok: false,
          error: "reserved_label",
          message: "Option label is reserved (" + RESERVED_LABELS.join(", ") + ")",
        };
      }
      if (seenLabels.has(label)) {
        return {
          ok: false,
          error: "duplicate_option_label",
          message: "Option labels must be unique within a question",
        };
      }
      seenLabels.add(label);
    }
  }

  return { ok: true };
}

// ── Dialog helpers ─────────────────────────────────────────────────────

function formatOptionLine(o: OptionData, index: number): string {
  let text = String(index + 1) + ". " + o.label + " - " + o.description;
  if (o.preview) text += " [Preview]";
  return text;
}

async function askSingleSelect(
  ctx: { ui: { select: Function; input: Function } },
  q: QuestionData,
  questionIndex: number,
): Promise<QuestionAnswer | undefined> {
  const header = q.header ? "[" + q.header + "] " : "";
  const options = q.options.map(formatOptionLine);
  options.push(String(q.options.length + 1) + ". " + OTHER_SENTINEL);

  const chosen: string | undefined = await ctx.ui.select(header + q.question, options, {});
  if (chosen === undefined) return undefined;

  const idx = Number.parseInt(chosen, 10) - 1;
  if (idx < 0 || idx >= options.length) return undefined;

  if (idx < q.options.length) {
    const o = q.options[idx];
    if (o === undefined) return undefined;
    return {
      questionIndex,
      question: q.question,
      kind: "option",
      answer: o.label,
      preview: o.preview,
    };
  }

  // "Type something." sentinel -> free-text input
  const typed: string | undefined = await ctx.ui.input(
    header + q.question,
    CUSTOM_ANSWER_PROMPT,
    {},
  );
  if (typed === undefined) return undefined;
  return { questionIndex, question: q.question, kind: "custom", answer: typed, preview: undefined };
}

async function askMultiSelect(
  ctx: { ui: { input: Function } },
  q: QuestionData,
  questionIndex: number,
): Promise<QuestionAnswer | undefined> {
  const header = q.header ? "[" + q.header + "] " : "";
  const list = q.options
    .map((o, i) => String(i + 1) + ". " + o.label + " - " + o.description)
    .join("\n");
  const instructions =
    'Enter the numbers of all that apply, comma-separated (e.g. "1,3"), or type a custom answer as plain text.';
  const value: string | undefined = await ctx.ui.input(
    header + q.question + "\n\n" + list + "\n\n" + instructions,
    "1,3",
    {},
  );
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      questionIndex,
      question: q.question,
      kind: "multi",
      answer: undefined,
      selected: [],
      preview: undefined,
    };
  }

  // Try to parse as comma/space-separated indices
  const tokens = trimmed.split(/[,\s]+/).filter((t) => t.length > 0);
  const indices = tokens.map((tok) => {
    if (/^\d+\.?$/.test(tok)) {
      const i = Number.parseInt(tok, 10) - 1;
      return i >= 0 && i < q.options.length ? i : undefined;
    }
    return undefined; // eslint-disable-line unicorn/no-useless-undefined
  });

  if (indices.every((i): i is number => i !== undefined)) {
    const selected: string[] = [];
    for (const i of indices) {
      const opt = q.options[i];
      if (opt === undefined) continue;
      if (!selected.includes(opt.label)) selected.push(opt.label);
    }
    return {
      questionIndex,
      question: q.question,
      kind: "multi",
      answer: undefined,
      selected,
      preview: undefined,
    };
  }

  // Non-index input -> custom answer
  return {
    questionIndex,
    question: q.question,
    kind: "custom",
    answer: trimmed,
    preview: undefined,
  };
}

// ── Response envelope ──────────────────────────────────────────────────

function buildToolResult(text: string, details: { answers: QuestionAnswer[]; cancelled: boolean }) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function buildQuestionnaireResponse(answers: QuestionAnswer[], cancelled: boolean) {
  if (cancelled) {
    return buildToolResult(DECLINE_MESSAGE, { answers, cancelled: true });
  }

  const segments: string[] = [];
  for (const a of answers) {
    let scalar: string;
    switch (a.kind) {
      case "multi":
        scalar = a.selected && a.selected.length > 0 ? a.selected.join(", ") : NO_INPUT_PLACEHOLDER;
        break;
      case "custom":
        scalar = a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
        break;
      case "option":
        scalar = a.answer ?? NO_INPUT_PLACEHOLDER;
        break;
    }
    const parts: string[] = ['"' + a.question + '"="' + scalar + '"'];
    if (a.preview && a.preview.length > 0) parts.push("selected preview: " + a.preview);
    segments.push(parts.join(". ") + ".");
  }

  const text = ENVELOPE_PREFIX + " " + segments.join(" ") + " " + ENVELOPE_SUFFIX;
  return buildToolResult(text, { answers, cancelled: false });
}

// ── Tool definition ────────────────────────────────────────────────────

export const askUserTool = defineTool({
  name: "ask_user",
  label: "Ask User",
  description: [
    "Ask the user one or more structured questions during execution. Use when you need to:",
    "1. Gather user preferences or requirements",
    "2. Clarify ambiguous instructions",
    "3. Get decisions on implementation choices as you work",
    "",
    "Usage notes:",
    "- Each question MUST have " +
      MIN_OPTIONS +
      "-" +
      MAX_OPTIONS +
      " options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs.",
    '- Set multiSelect: true when multiple answers are valid (e.g. "Which features do you want?").',
    "- The 'Type something.' option is always available for custom answers. Do NOT author 'Other' / 'Type something.' labels yourself — duplicates are rejected at runtime.",
    "- Use the optional preview field on options for code snippets, mockups, or visual comparisons.",
    "- Do not stack multiple ask_user calls back-to-back — group all clarifying questions into one invocation.",
    "- Ask up to " + MAX_QUESTIONS + " questions per invocation.",
  ].join("\n"),
  promptSnippet:
    "Ask the user up to " +
    MAX_QUESTIONS +
    " structured questions (" +
    MIN_OPTIONS +
    "-" +
    MAX_OPTIONS +
    " options each) when requirements are ambiguous",
  promptGuidelines: [
    "Use ask_user whenever the user's request is underspecified and you cannot proceed without concrete decisions - you can ask up to " +
      MAX_QUESTIONS +
      " questions per invocation.",
    "Each question MUST have " +
      MIN_OPTIONS +
      "-" +
      MAX_OPTIONS +
      " options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ('Type something.' row is appended automatically to every question).",
    "Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer context (mockups, code snippets, diagrams, configs) - single-select only.",
    "Do not stack multiple ask_user calls back-to-back - group all clarifying questions into one invocation.",
  ],
  parameters: askUserSchema,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    // ctx is inferred as ExtensionContext via defineTool's generic
    if (!ctx.hasUI) {
      return buildToolResult("Error: UI not available (running in non-interactive mode)", {
        answers: [],
        cancelled: true,
      });
    }

    const validation = validateQuestionnaire(params);
    if (!validation.ok) {
      return buildToolResult(validation.message, {
        answers: [],
        cancelled: true,
      });
    }

    const answers: QuestionAnswer[] = [];
    for (let qi = 0; qi < params.questions.length; qi++) {
      const q = params.questions[qi];
      if (q === undefined) continue;
      let answer: QuestionAnswer | undefined;

      if (q.multiSelect) {
        answer = await askMultiSelect(ctx, q, qi);
      } else {
        answer = await askSingleSelect(ctx, q, qi);
      }

      if (answer === undefined) {
        return buildQuestionnaireResponse(answers, true);
      }
      answers.push(answer);
    }

    return buildQuestionnaireResponse(answers, false);
  },
});
