import { MessageCircleQuestion } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";
import type { RespondToHumanRequest } from "../../types";

import { ToolErrorMessage, ToolInlineRow } from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
  respond: RespondToHumanRequest;
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

type AskUserAnswer = {
  questionIndex: number;
  kind: "option" | "custom" | "chat" | "multi";
  selected: string[];
  answer: string | undefined;
};

const CHAT_LABEL = "Chat about this";
const CUSTOM_LABEL = "Type something.";
const NEXT_LABEL = "Next";

function AgentThreadToolAskUser({ tool, respond }: Props) {
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
      <AskUserBody tool={tool} questions={questions} respond={respond} />
    </div>
  );
}

function AskUserBody({
  tool,
  questions,
  respond,
}: {
  tool: AgentThreadToolCallDisplay;
  questions: AskUserQuestion[];
  respond: RespondToHumanRequest;
}) {
  if (tool.output !== undefined || tool.status === "succeeded") {
    return <AnsweredAnswer output={tool.output} />;
  }
  if (tool.status === "failed") {
    return <ToolErrorMessage message={tool.errorMessage ?? "The question was canceled."} />;
  }
  return <AskUserForm requestId={tool.toolUiRequestId} questions={questions} respond={respond} />;
}

function AskUserForm({
  requestId,
  questions,
  respond,
}: {
  requestId: string | undefined;
  questions: AskUserQuestion[];
  respond: RespondToHumanRequest;
}) {
  const [answers, setAnswers] = useState<AskUserAnswer[]>(() => initialAnswers(questions));
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(void 0);

  async function submit() {
    if (requestId === undefined) {
      setError("The agent is not ready to receive this answer yet.");
      return;
    }
    const answersToSubmit = applyCustomAnswers(answers, customAnswers);
    if (answersToSubmit.length !== questions.length || answersToSubmit.some(isIncompleteAnswer)) {
      setError("Choose an answer for each question before sending.");
      return;
    }

    setError(void 0);
    setPending(true);
    const delivered = await respond(requestId, {
      answers: responseAnswers(answersToSubmit),
      cancelled: false,
    });
    if (!delivered) {
      setPending(false);
      setError("Could not send your answer. Try again.");
    }
  }

  if (questions.length === 0) {
    return <ToolErrorMessage message="The agent asked an invalid empty question set." />;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {questions.map((question, index) => (
          <QuestionPicker
            key={question.question}
            question={question}
            questionIndex={index}
            answer={answers[index]}
            disabled={pending}
            onAnswer={(answer) => setAnswers(replaceAnswer(answers, answer))}
            customAnswer={customAnswers[index] ?? ""}
            onCustomAnswerChange={(value) =>
              setCustomAnswers(replaceCustomAnswer(customAnswers, index, value))
            }
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
          {pending ? "Sending…" : "Send answers"}
        </Button>
        {error === undefined ? void 0 : <ToolErrorMessage message={error} />}
      </div>
    </div>
  );
}

function QuestionPicker({
  question,
  questionIndex,
  answer,
  customAnswer,
  disabled,
  onAnswer,
  onCustomAnswerChange,
}: {
  question: AskUserQuestion;
  questionIndex: number;
  answer: AskUserAnswer | undefined;
  customAnswer: string;
  disabled: boolean;
  onAnswer: (answer: AskUserAnswer) => void;
  onCustomAnswerChange: (value: string) => void;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-2 text-card-foreground">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {question.header}
        </span>
        <p className="min-w-0 flex-1 text-sm leading-5">{question.question}</p>
      </div>
      <div className="grid gap-1.5">
        {question.options.map((option) => (
          <AnswerRow
            key={option.label}
            label={option.label}
            description={option.description}
            preview={option.preview}
            selected={isSelected(answer, option.label)}
            disabled={disabled}
            onClick={() =>
              onAnswer(nextOptionAnswer(question, questionIndex, answer, option.label))
            }
          />
        ))}
        {question.multiSelect ? (
          <SentinelRow label={NEXT_LABEL} disabled={disabled} onClick={() => void 0} />
        ) : (
          <CustomRow
            value={customAnswer}
            disabled={disabled}
            selected={answer !== undefined && answer.kind === "custom"}
            onFocus={() => onAnswer(customAnswerForFocus(questionIndex))}
            onChange={onCustomAnswerChange}
          />
        )}
        <SentinelRow
          label={CHAT_LABEL}
          disabled={disabled}
          selected={answer !== undefined && answer.kind === "chat"}
          onClick={() => onAnswer(chatAnswer(questionIndex))}
        />
      </div>
    </section>
  );
}

function AnswerRow({
  label,
  description,
  preview,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  description: string;
  preview: string | undefined;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-selected={selected}
      className="rounded-md border border-border p-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 data-[selected=true]:border-ring data-[selected=true]:bg-accent"
      onClick={onClick}
    >
      <span className="font-medium">{label}</span>
      <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      {preview === undefined ? (
        void 0
      ) : (
        <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-editor-surface p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
          {preview}
        </pre>
      )}
    </button>
  );
}

function CustomRow({
  value,
  selected,
  disabled,
  onFocus,
  onChange,
}: {
  value: string;
  selected: boolean;
  disabled: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div
      data-selected={selected}
      className="rounded-md border border-border p-2 data-[selected=true]:border-ring data-[selected=true]:bg-accent"
    >
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{CUSTOM_LABEL}</span>
        <input
          aria-label={CUSTOM_LABEL}
          disabled={disabled}
          value={value}
          className="min-h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          onFocus={onFocus}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

function SentinelRow({
  label,
  selected = false,
  disabled,
  onClick,
}: {
  label: string;
  selected?: boolean | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-selected={selected}
      className="rounded-md border border-dashed border-border p-2 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 data-[selected=true]:border-ring data-[selected=true]:bg-accent"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function nextOptionAnswer(
  question: AskUserQuestion,
  questionIndex: number,
  current: AskUserAnswer | undefined,
  label: string,
): AskUserAnswer {
  if (!question.multiSelect) {
    return { questionIndex, kind: "option", selected: [label], answer: undefined };
  }

  const currentSelected = current === undefined ? [] : current.selected;
  const selected = currentSelected.includes(label)
    ? currentSelected.filter((candidate) => candidate !== label)
    : [...currentSelected, label];
  return { questionIndex, kind: "multi", selected, answer: undefined };
}

function customAnswerForFocus(questionIndex: number): AskUserAnswer {
  return { questionIndex, kind: "custom", selected: [], answer: undefined };
}
function customAnswerForSubmit(answer: AskUserAnswer, customAnswers: string[]): AskUserAnswer {
  const customAnswer = customAnswers[answer.questionIndex];
  return {
    ...answer,
    answer: customAnswer === undefined ? "" : customAnswer,
  };
}

function chatAnswer(questionIndex: number): AskUserAnswer {
  return { questionIndex, kind: "chat", selected: [], answer: CHAT_LABEL };
}

function isSelected(answer: AskUserAnswer | undefined, label: string): boolean {
  return answer !== undefined && answer.selected.includes(label);
}

function isIncompleteAnswer(answer: AskUserAnswer): boolean {
  if (answer.kind === "custom") {
    return answer.answer === undefined || answer.answer.trim().length === 0;
  }
  if (answer.kind === "chat") {
    return false;
  }
  return answer.selected.length === 0;
}

function responseAnswers(answers: AskUserAnswer[]) {
  return answers.map((answer) => ({
    questionIndex: answer.questionIndex,
    kind: answer.kind,
    selected: answer.selected,
    answer: answer.answer,
  }));
}

function applyCustomAnswers(answers: AskUserAnswer[], customAnswers: string[]) {
  return answers.map((answer) =>
    answer.kind === "custom" ? customAnswerForSubmit(answer, customAnswers) : answer,
  );
}
function replaceCustomAnswer(answers: string[], index: number, value: string) {
  return answers.map((answer, candidateIndex) => (candidateIndex === index ? value : answer));
}
function replaceAnswer(answers: AskUserAnswer[], answer: AskUserAnswer) {
  return answers.map((candidate) =>
    candidate.questionIndex === answer.questionIndex ? answer : candidate,
  );
}

function initialAnswers(questions: AskUserQuestion[]): AskUserAnswer[] {
  return questions.map((_question, questionIndex) => ({
    questionIndex,
    kind: "option",
    selected: [],
    answer: undefined,
  }));
}

function AnsweredAnswer({ output }: { output: unknown }) {
  const text = answerTextFromOutput(output);
  return (
    <p className="rounded-md border border-border bg-card p-2 text-xs whitespace-pre-wrap text-card-foreground">
      {text}
    </p>
  );
}

function answerTextFromOutput(output: unknown) {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return "";
  }
  const record = output as Record<string, unknown>;
  const details = record.details;
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    const result = answerTextFromDetails(details as Record<string, unknown>);
    if (result.length > 0) {
      return result;
    }
  }

  const content = record.content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (item): item is { type: "text"; text: string } =>
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).type === "text" &&
          typeof (item as Record<string, unknown>).text === "string",
      )
      .map((item) => item.text);
    return textParts.join("\n");
  }

  return "";
}

function answerTextFromDetails(details: Record<string, unknown>) {
  const answers = details.answers;
  if (!Array.isArray(answers)) {
    return "";
  }
  const lines = answers
    .map((answer) => {
      if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
        return "";
      }
      const record = answer as Record<string, unknown>;
      const question = typeof record.question === "string" ? record.question : "Question";
      const selected = Array.isArray(record.selected)
        ? record.selected.filter((item): item is string => typeof item === "string")
        : [];
      const answerText = typeof record.answer === "string" ? record.answer : selected.join(", ");
      return answerText.length > 0 ? `${question}: ${answerText}` : "";
    })
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

function questionsFromTool(tool: AgentThreadToolCallDisplay): AskUserQuestion[] {
  if (typeof tool.input !== "object" || tool.input === null || Array.isArray(tool.input)) {
    return [];
  }
  const record = tool.input as Record<string, unknown>;
  const questions = record.questions;
  return Array.isArray(questions) ? questions.flatMap(questionFromUnknown) : [];
}

function questionFromUnknown(value: unknown): AskUserQuestion[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : undefined;
  const header = typeof record.header === "string" ? record.header : "Question";
  const options = optionsFromUnknown(record.options);
  if (question === undefined || options.length === 0) {
    return [];
  }
  return [
    {
      question,
      header,
      options,
      multiSelect: record.multiSelect === true,
    },
  ];
}

function optionsFromUnknown(value: unknown): AskUserOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((option) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      return [];
    }
    const record = option as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : undefined;
    const description = typeof record.description === "string" ? record.description : undefined;
    if (label === undefined || description === undefined) {
      return [];
    }
    return [
      {
        label,
        description,
        preview: typeof record.preview === "string" ? record.preview : void 0,
      },
    ];
  });
}

export { AgentThreadToolAskUser };
