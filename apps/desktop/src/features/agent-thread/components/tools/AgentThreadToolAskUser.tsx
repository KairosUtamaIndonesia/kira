/**
 * AgentThreadToolAskUser — display-only component for the ask_user tool call.
 *
 * The actual interaction (selecting options) goes through the ExtensionUiInline,
 * which handles extension_ui_request/extension_ui_response events. This component
 * shows the questions (input) and answers (output) in the transcript.
 */

import { MessageCircleQuestion } from "lucide-react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import { ToolErrorMessage, ToolInlineRow } from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
};

type AskUserOption = {
  label: string;
  description: string;
  preview: string | undefined;
};

type AskUserQuestion = {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect: boolean;
};



function AgentThreadToolAskUser({ tool }: Props) {
  const questions = questionsFromTool(tool);
  const firstQuestion = questions[0];

  return (
    <div className="space-y-2">
      <ToolInlineRow
        icon={<MessageCircleQuestion aria-hidden="true" className="size-3" />}
        label={
          <span className="break-words whitespace-normal">
            {firstQuestion === undefined ? "Asked the user" : firstQuestion.question}
          </span>
        }
        labelWrap
      />
      <AskUserBody tool={tool} questions={questions} />
    </div>
  );
}

function AskUserBody({
  tool,
  questions,
}: {
  tool: AgentThreadToolCallDisplay;
  questions: AskUserQuestion[];
}) {
  if (tool.output !== undefined || tool.status === "succeeded") {
    return <AnsweredAnswer output={tool.output} />;
  }
  if (tool.status === "failed") {
    return <ToolErrorMessage message={tool.errorMessage ?? "The question was canceled."} />;
  }
  // Tool is running — show questions as pending
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      {questions.map((q, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">
            Q{i + 1}:
          </span>
          <span>{q.question}</span>
        </div>
      ))}
      <p className="italic text-xs">Waiting for your response...</p>
    </div>
  );
}

function AnsweredAnswer({ output }: { output: unknown }) {
  const text = answerTextFromOutput(output);
  if (text.length === 0) return null;
  return (
    <div className="rounded-md border bg-editor-surface-secondary px-3 py-2 text-sm">
      {text}
    </div>
  );
}

/**
 * Extract display text from the tool result.
 *
 * The tool result arrives as either:
 * 1. A string (the envelope text, extracted by extractResultText in the hook)
 * 2. An object with a "content" array of text blocks
 * 3. An object with "details" containing structured answers
 */
function answerTextFromOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "";

  // Check for { content: [{ type: "text", text }] }
  if ("content" in output && Array.isArray(output.content)) {
    const parts: string[] = [];
    for (const block of output.content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        parts.push(block.text);
      }
    }
    return parts.join("\n");
  }

  // Fallback: check for { details: { answers } }
  if ("details" in output && output.details && typeof output.details === "object") {
    return answerTextFromDetails(output.details);
  }

  return "";
}

function answerTextFromDetails(details: object): string {
  if (!("answers" in details) || !Array.isArray(details.answers)) return "";

  const lines: string[] = [];
  for (const a of details.answers) {
    if (!a || typeof a !== "object") continue;

    const question =
      "question" in a && typeof a.question === "string" ? a.question : "";

    if ("kind" in a && a.kind === "multi") {
      // Multi-select: show selected labels
      const selected =
        "selected" in a && Array.isArray(a.selected)
          ? a.selected.filter((s: unknown): s is string => typeof s === "string")
          : [];
      const answerText = selected.length > 0 ? selected.join(", ") : "(no input)";
      lines.push(question + ": " + answerText);
    } else if ("kind" in a && a.kind === "custom") {
      // Custom/free-text: show the typed answer
      const answer =
        "answer" in a && typeof a.answer === "string" ? a.answer : "(no input)";
      lines.push(question + ": " + answer);
    } else if ("kind" in a && a.kind === "option") {
      // Option selection: show the label
      const answer =
        "answer" in a && typeof a.answer === "string" ? a.answer : "(no input)";
      lines.push(question + ": " + answer);
    } else if ("cancelled" in a && a.cancelled) {
      lines.push(question + ": skipped");
    } else {
      // Legacy fallback: try answer field
      const answer =
        "answer" in a && typeof a.answer === "string" ? a.answer : "(no input)";
      lines.push(question + ": " + answer);
    }
  }

  return lines.join("\n");
}

function questionsFromTool(tool: AgentThreadToolCallDisplay): AskUserQuestion[] {
  try {
    const parsed = JSON.parse(tool.input);
    const raw: unknown = parsed.questions ?? parsed;
    if (Array.isArray(raw)) return raw.map(questionFromUnknown);
    return [];
  } catch {
    return [questionFromUnknown(tool.input)];
  }
}

function questionFromUnknown(value: unknown): AskUserQuestion {
  if (!value || typeof value !== "object") {
    return { question: String(value), header: "", options: [], multiSelect: false };
  }
  const question =
    "question" in value && typeof value.question === "string" ? value.question : "";
  const header =
    "header" in value && typeof value.header === "string"
      ? value.header.slice(0, 16)
      : "";
  const multiSelect = "multiSelect" in value && Boolean(value.multiSelect);
  const options =
    "options" in value ? optionsFromUnknown(value.options) : [];

  return { question, header, options, multiSelect };
}

function optionsFromUnknown(value: unknown): AskUserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") {
      return { label: String(item), description: "", preview: undefined };
    }
    const label =
      "label" in item && typeof item.label === "string"
        ? item.label.slice(0, 60)
        : "";
    const description =
      "description" in item && typeof item.description === "string"
        ? item.description
        : "";
    const preview =
      "preview" in item && typeof item.preview === "string"
        ? item.preview
        : undefined;
    return { label, description, preview };
  });
}

export { AgentThreadToolAskUser };
