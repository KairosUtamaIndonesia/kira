import { useVirtualizer } from "@tanstack/react-virtual";
import { Brain, ChevronRight, CornerUpLeft, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { AgentThreadActivityBlock } from "../agentThreadDisplay";
import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";
import type { PiTranscriptState, RespondToHumanRequest } from "../types";

import { buildAgentThreadTranscript, stringifyUnknown } from "../agentThreadDisplay";
import { AgentThreadCompactionCard } from "./AgentThreadCompactionCard";
import { AgentThreadMarkdown } from "./AgentThreadMarkdown";
import { AgentThreadUserSkillBlock } from "./AgentThreadUserSkillBlock";
import { toolComponentForName } from "./tools";
type AgentThreadTranscriptProps = {
  transcript: PiTranscriptState;
  compactionSummary?: { tokensBefore: number; summary: string } | undefined;
  editingMessageId?: string | undefined;
  respond: RespondToHumanRequest;
  onResend: (id: string, text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => void;
  runtimeState: AgentThreadRuntimeState;
  parentRef: RefObject<HTMLDivElement | null>;
  onHeightChange?: () => void;
  onVirtualizerReady?: (api: {
    scrollToIndex: (
      index: number,
      options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior },
    ) => void;
  }) => void;
};
function AgentThreadTranscript({
  transcript,
  compactionSummary,
  editingMessageId,
  respond,
  onResend,
  onEdit,
  runtimeState,
  parentRef,
  onHeightChange,
  onVirtualizerReady,
}: AgentThreadTranscriptProps) {
  const items = buildAgentThreadTranscript(transcript);
  const rootNode =
    transcript.treeNodes === undefined
      ? undefined
      : transcript.treeNodes.find((n) => n.parentId === null);
  const rootMessageId = rootNode === undefined ? undefined : rootNode.entry.messageId;

  // Include compaction summary as a virtual item so it scrolls with the list
  const allItems = useMemo(() => {
    if (compactionSummary === undefined) return items;
    return [
      ...items,
      {
        type: "compaction-summary" as const,
        id: "compaction-summary",
        tokensBefore: compactionSummary.tokensBefore,
        summary: compactionSummary.summary,
      },
    ];
  }, [items, compactionSummary]);

  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  });

  // Expose scroll API to parent for scroll-to-bottom control
  useEffect(() => {
    if (onVirtualizerReady !== undefined) {
      onVirtualizerReady({
        scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options),
      });
    }
  });

  // Notify parent when item count changes so it can update scroll tracking
  const prevCountRef = useRef(allItems.length);
  useEffect(() => {
    if (prevCountRef.current !== allItems.length) {
      prevCountRef.current = allItems.length;
      if (onHeightChange !== undefined) {
        onHeightChange();
      }
    }
  }, [allItems.length, onHeightChange]);

  if (allItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Agent Thread messages will appear here after you send a prompt.
        </div>
      </div>
    );
  }

  const lastIndex = allItems.length - 1;

  const visibleItems = virtualizer
    .getVirtualItems()
    .map((row) => ({ virtualRow: row, item: allItems[row.index] }))
    .filter(
      (
        entry,
      ): entry is {
        virtualRow: (typeof entry)["virtualRow"];
        item: NonNullable<(typeof entry)["item"]>;
      } => entry.item !== undefined,
    );

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {visibleItems.map(({ virtualRow, item }) => {
        const isLast = virtualRow.index === lastIndex;

        let content: ReactNode;
        switch (item.type) {
          case "user-message": {
            const isEditing = editingMessageId === item.id;
            content = (
              <div className="flex justify-end">
                <article
                  className={
                    "group relative max-w-[min(42rem,85%)] space-y-2 rounded-xl border p-3 text-card-foreground " +
                    (isEditing
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border bg-card")
                  }
                  data-message-ids={item.id.split(":").join(" ")}
                >
                  <TooltipProvider>
                    <ButtonGroup className="absolute right-2 -bottom-3 rounded-lg border border-border bg-card opacity-0 shadow-xs transition-opacity group-hover:opacity-100">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={
                                (runtimeState.status !== "ready" &&
                                  runtimeState.status !== "error") ||
                                rootMessageId === item.id
                              }
                              onClick={() => void onResend(item.id, item.text)}
                            />
                          }
                        >
                          <CornerUpLeft />
                        </TooltipTrigger>
                        <TooltipContent>Resend</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onEdit(item.id, item.text)}
                            />
                          }
                        >
                          <Pencil />
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                    </ButtonGroup>
                  </TooltipProvider>
                  <MessageHeader label="You" createdAt={item.createdAt} />
                  {item.blocks.length === 0 ? (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{item.text}</p>
                  ) : (
                    item.blocks.map((block) => (
                      <UserMessageBlock key={userMessageBlockKey(item.id, block)} block={block} />
                    ))
                  )}
                </article>
              </div>
            );
            break;
          }
          case "assistant-activity": {
            content = (
              <div className="flex justify-start">
                <article className="w-full space-y-4 rounded-xl p-3 text-foreground">
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
                      onHeightChange={onHeightChange}
                    />
                  ))}
                </article>
              </div>
            );
            break;
          }
          case "compaction-summary": {
            content = (
              <div className="flex justify-start">
                <AgentThreadCompactionCard
                  tokensBefore={item.tokensBefore}
                  summary={item.summary}
                />
              </div>
            );
            break;
          }
        }

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div className="mx-auto max-w-5xl px-2">{content}</div>
            {!isLast && <div className="h-6" />}
          </div>
        );
      })}
    </div>
  );
}

function ActivityBlock({
  block,
  isStreaming,
  respond,
  onHeightChange,
}: {
  block: AgentThreadActivityBlock;
  isStreaming: boolean;
  respond: RespondToHumanRequest;
  onHeightChange: (() => void) | undefined;
}) {
  if (block.type === "thinking") {
    return (
      <ThinkingBlock
        thinking={block.thinking}
        isStreaming={isStreaming}
        onHeightChange={onHeightChange}
      />
    );
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

function ThinkingBlock({
  thinking,
  isStreaming,
  onHeightChange,
}: {
  thinking: string;
  isStreaming: boolean;
  onHeightChange: (() => void) | undefined;
}) {
  const [isOpen, setIsOpen] = useState(true);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
    // Notify virtualizer after CSS transition completes (duration-150 = 150ms)
    setTimeout(() => {
      if (onHeightChange !== undefined) onHeightChange();
    }, 200);
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
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
