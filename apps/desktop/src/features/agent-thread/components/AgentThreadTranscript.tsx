import { Brain, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { AgentThreadActivityBlock } from "../agentThreadDisplay";
import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";
import type { PiTranscriptState } from "../types";

import { buildAgentThreadTranscript, stringifyUnknown } from "../agentThreadDisplay";
import { AgentThreadMarkdown } from "./AgentThreadMarkdown";
import { toolComponentForName } from "./tools";

type AgentThreadTranscriptProps = {
  transcript: PiTranscriptState;
  runtimeState: AgentThreadRuntimeState;
  parentRef: React.RefObject<HTMLDivElement | null>;
};

function AgentThreadTranscript({ transcript, runtimeState }: AgentThreadTranscriptProps) {
  const items = useMemo(() => buildAgentThreadTranscript(transcript), [transcript]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Agent Thread messages will appear here after you send a prompt.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-2">
      {items.map((item) => {
        let content: ReactNode;

        switch (item.type) {
          case "user-message":
            content = (
              <div className="flex justify-end">
                <article className="group relative max-w-[min(42rem,85%)] space-y-2 rounded-xl border border-border bg-card p-3 text-card-foreground">
                  <MessageHeader label="You" />
                  <p className="text-sm leading-6 whitespace-pre-wrap">{item.text}</p>
                </article>
              </div>
            );
            break;

          case "assistant-activity":
            content = (
              <div className="flex justify-start">
                <article className="w-full space-y-4 rounded-xl text-foreground">
                  {/*<MessageHeader label="Kira" />*/}
                  {item.blocks.length === 0 && item.isStreaming ? (
                    <p className="text-sm text-muted-foreground">Working…</p>
                  ) : undefined}
                  {item.blocks.map((block, index) => (
                    <ActivityBlock
                      key={blockKey(block)}
                      block={block}
                      isStreaming={item.isStreaming && index === item.blocks.length - 1}
                    />
                  ))}
                </article>
              </div>
            );
            break;
        }

        return <div key={item.id}>{content}</div>;
      })}
    </div>
  );
}

function ActivityBlock({
  block,
  isStreaming,
}: {
  block: AgentThreadActivityBlock;
  isStreaming: boolean;
}) {
  if (block.type === "thinking") {
    return <ThinkingBlock thinking={block.thinking} isStreaming={isStreaming} />;
  }
  if (block.type === "markdown") {
    return <AgentThreadMarkdown markdown={block.markdown} isStreaming={isStreaming} />;
  }
  if (block.type === "tool-call") {
    const Component = toolComponentForName(block.tool.toolName);
    return <Component tool={block.tool} />;
  }
  return null;
}

function blockKey(block: AgentThreadActivityBlock): string {
  if (block.type === "tool-call") return block.tool.id;
  return block.id;
}

function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming: boolean }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full max-w-full min-w-0 cursor-pointer items-center gap-2 text-left"
      >
        <Brain aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {isOpen ? "Thinking" : preview(thinking)}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-150 ease-out ${
            isOpen ? "rotate-90" : ""
          }`}
        />
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-150 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex pt-1">
            <button
              type="button"
              className="w-2 shrink-0 cursor-pointer"
              onClick={() => setIsOpen(false)}
              aria-label="Collapse thinking"
            >
              <div className="ml-0.5 h-full w-0.5 rounded-full bg-border/30 transition-colors hover:bg-border" />
            </button>
            <div className="min-w-0 flex-1 pl-3">
              <AgentThreadMarkdown
                markdown={thinking}
                isStreaming={isStreaming}
                className="text-muted-foreground/70"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function preview(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

function MessageHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
    </div>
  );
}

export { AgentThreadTranscript };
