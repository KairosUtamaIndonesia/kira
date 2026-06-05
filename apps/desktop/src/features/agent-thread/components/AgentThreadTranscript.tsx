import { Bot, User } from "lucide-react";

import type { AgentThreadMessageRecord } from "../types";

import { buildAgentThreadTranscript, stringifyUnknown } from "../agentThreadDisplay";
import { AgentThreadMarkdown } from "./AgentThreadMarkdown";
import { AgentThreadToolCall } from "./AgentThreadToolCall";

type AgentThreadTranscriptProps = {
  messages: AgentThreadMessageRecord[];
  runtimeIsSending: boolean;
};

function AgentThreadTranscript({ messages, runtimeIsSending }: AgentThreadTranscriptProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Agent Thread messages will appear here after you send a prompt.
      </div>
    );
  }

  const transcript = buildAgentThreadTranscript(messages, runtimeIsSending);

  return (
    <ol className="space-y-4">
      {transcript.map((item) => {
        if (item.type === "user-message") {
          return (
            <li key={item.id} className="flex justify-end">
              <article className="max-w-[min(42rem,85%)] rounded-xl border border-border bg-card p-3 text-card-foreground">
                <MessageHeader icon="user" label="You" createdAt={item.createdAt} />
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{item.text}</p>
              </article>
            </li>
          );
        }

        if (item.type === "assistant-message") {
          return (
            <li key={item.id} className="flex justify-start">
              <article className="max-w-[min(48rem,92%)] rounded-xl border border-border bg-background p-3 text-foreground">
                <MessageHeader icon="assistant" label="Kira" createdAt={item.createdAt} />
                <div className="mt-2">
                  <AgentThreadMarkdown markdown={item.markdown} isStreaming={item.isStreaming} />
                </div>
              </article>
            </li>
          );
        }

        if (item.type === "tool-call") {
          return (
            <li key={item.id} className="max-w-[min(48rem,92%)]">
              <AgentThreadToolCall
                title={item.title}
                status={item.status}
                command={item.command}
                cwd={item.cwd}
                exitCode={item.exitCode}
                duration={item.duration}
                changedFiles={item.changedFiles}
                errorMessage={item.errorMessage}
                details={item.details}
              />
            </li>
          );
        }

        if (item.type === "error") {
          return (
            <li key={item.id}>
              <details className="rounded-xl border border-border bg-card p-3 text-card-foreground">
                <summary className="cursor-pointer text-sm text-destructive">
                  {item.message}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-editor-surface p-2 font-mono text-xs text-foreground">
                  {stringifyUnknown(item.details)}
                </pre>
              </details>
            </li>
          );
        }

        if (item.type === "event") {
          return (
            <li key={item.id}>
              <details className="rounded-lg border border-border bg-card/60 p-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{item.label}</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-editor-surface p-2 font-mono text-xs text-foreground">
                  {stringifyUnknown(item.details)}
                </pre>
              </details>
            </li>
          );
        }

        return exhaustiveTranscriptItem(item);
      })}
    </ol>
  );
}

function MessageHeader({
  createdAt,
  icon,
  label,
}: {
  createdAt: string;
  icon: "assistant" | "user";
  label: string;
}) {
  const Icon = icon === "user" ? User : Bot;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="font-medium text-foreground">{label}</span>
      <time dateTime={createdAt}>{formatTimestamp(createdAt)}</time>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function exhaustiveTranscriptItem(value: never): never {
  throw new Error(`Unknown Agent Thread transcript item: ${String(value)}`);
}

export { AgentThreadTranscript };
