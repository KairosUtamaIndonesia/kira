/**
 * AgentThreadToolAskUser — display-only component for the ask_user tool call.
 *
 * The actual interaction (selecting options) goes through the ExtensionUiModal,
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

function answerTextFromOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "";
  const content = (output as Record<string, unknown>).content;
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
          return (block as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const details = (output as Record<string, unknown>).details;
  if (details && typeof details === "object") {
    return answerTextFromDetails(details as Record<string, unknown>);
  }
  return "";
}

function answerTextFromDetails(details: Record<string, unknown>): string {
  const answers = details.answers;
  if (!Array.isArray(answers)) return "";
  return answers
    .map((a: unknown) => {
      if (!a || typeof a !== "object") return "";
      const ans = a as Record<string, unknown>;
      if (ans.cancelled) return `${ans.question as string}: skipped`;
      return `${ans.question as string}: ${ans.answer as string}`;
    })
    .join("\n");
}

function questionsFromTool(tool: AgentThreadToolCallDisplay): AskUserQuestion[] {
  try {
    const parsed = JSON.parse(tool.input);
    const raw = parsed.questions ?? parsed;
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
  const obj = value as Record<string, unknown>;
  return {
    question: String(obj.question ?? ""),
    header: String(obj.header ?? "").slice(0, 16),
    options: optionsFromUnknown(obj.options),
    multiSelect: Boolean(obj.multiSelect),
  };
}

function optionsFromUnknown(value: unknown): AskUserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") {
      return { label: String(item), description: "", preview: undefined };
    }
    const obj = item as Record<string, unknown>;
    return {
      label: String(obj.label ?? "").slice(0, 60),
      description: String(obj.description ?? ""),
      preview: obj.preview !== undefined ? String(obj.preview) : undefined,
    };
  });
}

export { AgentThreadToolAskUser };
