import { Brain } from "lucide-react";

import type { AgentThreadActivityBlock } from "../agentThreadDisplay";
import type { PiTranscriptState, RespondToHumanRequest } from "../types";

import { buildAgentThreadTranscript, stringifyUnknown } from "../agentThreadDisplay";
import { AgentThreadCompactionCard } from "./AgentThreadCompactionCard";
import { AgentThreadMarkdown } from "./AgentThreadMarkdown";
import { AgentThreadUserSkillBlock } from "./AgentThreadUserSkillBlock";
import { toolComponentForName } from "./tools";

type AgentThreadTranscriptProps = {
  transcript: PiTranscriptState;
  compactionSummary?: { tokensBefore: number; summary: string } | undefined;
  respond: RespondToHumanRequest;
};
function AgentThreadTranscript({
  transcript,
  compactionSummary,
  respond,
}: AgentThreadTranscriptProps) {
  const items = buildAgentThreadTranscript(transcript);
  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Agent Thread messages will appear here after you send a prompt.
      </div>
    );
  }

  return (
    <ol className="space-y-5">
      {items.map((item) => {
        if (item.type === "user-message") {
          return (
            <li key={item.id} className="flex justify-end">
              <article className="max-w-[min(42rem,85%)] space-y-2 rounded-xl border border-border bg-card p-3 text-card-foreground">
                <MessageHeader label="You" createdAt={item.createdAt} />
                {item.blocks.length === 0 ? (
                  <p className="text-sm leading-6 whitespace-pre-wrap">{item.text}</p>
                ) : (
                  item.blocks.map((block) => (
                    <UserMessageBlock key={userMessageBlockKey(item.id, block)} block={block} />
                  ))
                )}
              </article>
            </li>
          );
        }

        if (item.type === "assistant-activity") {
          return (
            <li key={item.id} className="flex justify-start">
              <article className="w-full space-y-3 rounded-xl p-3 text-foreground">
                <MessageHeader label="Kira" createdAt={item.createdAt} />
                {item.blocks.length === 0 && item.isStreaming ? (
                  <p className="text-sm text-muted-foreground">Working…</p>
                ) : undefined}
                {item.blocks.map((block, index) => (
                  <ActivityBlock
                    key={blockKey(block)}
                    block={block}
                    isStreaming={item.isStreaming && index === item.blocks.length - 1}
                    respond={respond}
                  />
                ))}
              </article>
            </li>
          );
        }

        return exhaustiveTranscriptItem(item);
      })}
      {compactionSummary !== undefined ? (
        <li className="flex justify-start">
          <AgentThreadCompactionCard
            tokensBefore={compactionSummary.tokensBefore}
            summary={compactionSummary.summary}
          />
        </li>
      ) : undefined}
    </ol>
  );
}

function ActivityBlock({
  block,
  isStreaming,
  respond,
}: {
  block: AgentThreadActivityBlock;
  isStreaming: boolean;
  respond: RespondToHumanRequest;
}) {
  if (block.type === "thinking") {
    return <ThinkingBlock thinking={block.thinking} />;
  }

  if (block.type === "markdown") {
    return <AgentThreadMarkdown markdown={block.markdown} isStreaming={isStreaming} />;
  }

  if (block.type === "tool-call") {
    const Component = toolComponentForName(block.tool.toolName);
    return <Component tool={block.tool} respond={respond} />;
  }

  if (block.type === "error") {
    return <ErrorBlock message={block.error.message} details={block.error.details} />;
  }

  return exhaustiveActivityBlock(block);
}

function blockKey(block: AgentThreadActivityBlock) {
  if (block.type === "tool-call") {
    return block.tool.id;
  }

  if (block.type === "error") {
    return block.error.id;
  }

  return block.id;
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  return (
    <details className="rounded-lg border border-border bg-card/60 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
        <Brain aria-hidden="true" className="size-3.5" />
        Thinking
      </summary>
      <div className="mt-2 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
        {thinking}
      </div>
    </details>
  );
}

function ErrorBlock({ details, message }: { details: unknown; message: string }) {
  return (
    <details className="rounded-xl border border-border bg-card p-3 text-card-foreground">
      <summary className="cursor-pointer text-sm text-destructive">{message}</summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-editor-surface p-2 font-mono text-xs text-foreground">
        {stringifyUnknown(details)}
      </pre>
    </details>
  );
}

function MessageHeader({ createdAt, label }: { createdAt: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <time dateTime={createdAt}>{formatTimestamp(createdAt)}</time>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function exhaustiveTranscriptItem(value: never): never {
  throw new Error(`Unknown Agent Thread transcript item: ${String(value)}`);
}

function exhaustiveActivityBlock(value: never): never {
  throw new Error(`Unknown Agent Thread activity block: ${String(value)}`);
}

function UserMessageBlock({
  block,
}: {
  block:
    | { type: "text"; text: string }
    | { type: "skill"; name: string; location: string | undefined; body: string };
}) {
  if (block.type === "skill") {
    return <AgentThreadUserSkillBlock block={block} />;
  }
  if (block.text.trim().length === 0) {
    return <></>;
  }
  return <p className="text-sm leading-6 whitespace-pre-wrap">{block.text}</p>;
}

function userMessageBlockKey(
  messageId: string,
  block:
    | { type: "text"; text: string }
    | { type: "skill"; name: string; location: string | undefined; body: string },
): string {
  return block.type === "skill"
    ? `${messageId}:skill:${block.name}:${block.location ?? ""}`
    : `${messageId}:text:${block.text.length}`;
}

export { AgentThreadTranscript };
