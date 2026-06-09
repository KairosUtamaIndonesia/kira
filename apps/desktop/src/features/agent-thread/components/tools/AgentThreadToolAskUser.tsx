import { MessageCircleQuestion } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";
import type { RespondToHumanRequest } from "../../types";

import { ToolErrorMessage, ToolInlineRow } from "./ToolPrimitives";

type Props = {
  tool: AgentThreadToolCallDisplay;
  respond: RespondToHumanRequest;
};
function AgentThreadToolAskUser({ tool, respond }: Props) {
  const { question, options } = askDetailsFromTool(tool);

  return (
    <div className="space-y-2">
      <ToolInlineRow
        icon={<MessageCircleQuestion aria-hidden="true" className="size-3" />}
        label={
          <span className="break-words whitespace-normal">{question ?? "Asked the user"}</span>
        }
        labelWrap
      />
      <AskUserBody tool={tool} options={options} respond={respond} />
    </div>
  );
}

function AskUserBody({
  tool,
  options,
  respond,
}: {
  tool: AgentThreadToolCallDisplay;
  options: string[] | undefined;
  respond: RespondToHumanRequest;
}) {
  if (tool.output !== undefined || tool.status === "succeeded") {
    return <AnsweredAnswer output={tool.output} />;
  }
  if (tool.status === "failed") {
    return <ToolErrorMessage message={tool.errorMessage ?? "The question was canceled."} />;
  }
  return <AskUserForm options={options} respond={respond} />;
}

function AskUserForm({
  options,
  respond,
}: {
  options: string[] | undefined;
  respond: RespondToHumanRequest;
}) {
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(void 0);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError("Enter an answer before sending.");
      return;
    }
    setError(void 0);
    setPending(true);
    const delivered = await respond({ answer: trimmed });
    if (!delivered) {
      setPending(false);
      setError("Could not send your answer. Try again.");
    }
  }

  if (options !== undefined && options.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void submit(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        {error === undefined ? void 0 : <ToolErrorMessage message={error} />}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        value={answer}
        disabled={pending}
        placeholder="Type your answer…"
        className="min-h-16 text-sm"
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit(answer);
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || answer.trim().length === 0}
          onClick={() => void submit(answer)}
        >
          {pending ? "Sending…" : "Send answer"}
        </Button>
        <span className="text-xs text-muted-foreground/60">⌘/Ctrl + Enter</span>
      </div>
      {error === undefined ? void 0 : <ToolErrorMessage message={error} />}
    </div>
  );
}

function AnsweredAnswer({ output }: { output: unknown }) {
  let text = "";
  if (typeof output === "string") {
    text = output;
  } else if (output !== undefined) {
    text = String(output);
  }
  return (
    <p className="rounded-md border border-border bg-card p-2 text-xs whitespace-pre-wrap text-card-foreground">
      {text}
    </p>
  );
}

function askDetailsFromTool(tool: AgentThreadToolCallDisplay): {
  question: string | undefined;
  options: string[] | undefined;
} {
  if (typeof tool.input !== "object" || tool.input === null || Array.isArray(tool.input)) {
    return { question: void 0, options: void 0 };
  }
  const record = tool.input as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : void 0;
  const options =
    Array.isArray(record.options) && record.options.every((value) => typeof value === "string")
      ? (record.options as string[])
      : void 0;
  return { question, options };
}

export { AgentThreadToolAskUser };
