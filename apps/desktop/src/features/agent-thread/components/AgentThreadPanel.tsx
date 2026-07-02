import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { explorerDragDataKey } from "@/features/explorer";
import { useAppearanceTheme } from "@/features/settings";

import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";
import type { AgentThreadPanelParams, PiTranscriptState } from "../types";

import { buildAgentThreadTranscript } from "../agentThreadDisplay";
import { setAgentThreadDraft } from "../agentThreadDraftStore";
import { explorerDropPaths, fileReferenceText } from "../explorerDropUtils";
import { useAgentThreadConnection } from "../hooks/useAgentThreadConnection";
import { AgentActionIndicator } from "./AgentActionIndicator";
import { AgentThreadRawEventStream } from "./AgentThreadRawEventStream";
import { AgentThreadTranscript } from "./AgentThreadTranscript";
import { Composer } from "./Composer";
import { SessionTree } from "./SessionTree";

type AgentThreadPanelProps = {
  api: { setTitle(title: string): void };
  params: AgentThreadPanelParams;
  initialPrompt?: string;
  onRename?: (panelId: string, title: string) => Promise<void>;
  isActive?: boolean;
};

function AgentThreadPanel({ params }: AgentThreadPanelProps) {
  const { agentThreadShowRawEventStream } = useAppearanceTheme();
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isTreeOpen, setIsTreeOpen] = useState(false);

  const {
    messages,
    isStreaming,
    model,
    currentLeafId,
    isCompacting,
    treeNodes,
    runtimeState,
    toolOutputs,
    sendPrompt,
    abortPrompt,
    navigateTree,
  } = useAgentThreadConnection(params);

  const transcript: PiTranscriptState = { messages, isStreaming, model };
  const items = buildAgentThreadTranscript(transcript, toolOutputs);
  const isEmpty = items.length === 0;

  const handleSendPrompt = useCallback(
    async (text: string): Promise<boolean> => sendPrompt(text),
    [sendPrompt],
  );

  const handleAbort = useCallback(() => abortPrompt(), [abortPrompt]);

  const treeContent = (() => {
    if (!isTreeOpen) return;
    if (treeNodes.length === 0) {
      return (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          No session tree data available.
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-border p-2">
        <div className="max-h-[60vh] overflow-y-auto">
          <SessionTree
            nodes={treeNodes}
            activePath={[]}
            activeLeafId={currentLeafId}
            onSelectNode={(entryId: string) => {
              void navigateTree(entryId);
              setIsTreeOpen(false);
            }}
          />
        </div>
      </div>
    );
  })();

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-6 bg-editor-surface text-foreground"
      onDragEnter={(event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(explorerDragDataKey)) return;
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingFile(true);
      }}
      onDragLeave={(event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(explorerDragDataKey)) return;
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDraggingFile(false);
      }}
      onDragOver={handleExplorerDragOver}
      onDrop={(event: DragEvent<HTMLElement>) => {
        dragCounterRef.current = 0;
        setIsDraggingFile(false);
        if (event.defaultPrevented) return;
        const paths = explorerDropPaths(event.dataTransfer);
        if (paths.length === 0) return;
        event.preventDefault();
        setAgentThreadDraft(params.threadId, paths.map(fileReferenceText).join(" "), "inline");
      }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <TranscriptArea
          transcript={transcript}
          isEmpty={isEmpty}
          agentThreadShowRawEventStream={agentThreadShowRawEventStream}
          runtimeState={runtimeState}
        />
      </div>
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1.5">
          {treeContent}
          <AgentActionIndicator runtimeState={runtimeState} isCompacting={isCompacting} />
          <Composer
            threadId={params.threadId}
            folderPath={params.folderPath}
            runtimeState={runtimeState}
            sendPrompt={handleSendPrompt}
            abortPrompt={handleAbort}
            isDropTargetActive={isDraggingFile}
            isTreeOpen={isTreeOpen}
            onToggleTree={() => setIsTreeOpen((open) => !open)}
          />
        </div>
      </footer>
    </section>
  );
}

type TranscriptAreaProps = {
  transcript: PiTranscriptState;
  isEmpty: boolean;
  agentThreadShowRawEventStream: boolean;
  runtimeState: AgentThreadRuntimeState;
};

function TranscriptArea({
  transcript,
  isEmpty,
  agentThreadShowRawEventStream,
  runtimeState,
}: TranscriptAreaProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el === null) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current)
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      if (scrollContainerRef.current)
        scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight });
    }
  }, [transcript.messages.length, transcript.isStreaming]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        className={`min-h-0 flex-1 overflow-y-auto ${isEmpty ? "flex items-center justify-center p-2" : "p-2"}`}
        onScroll={handleScroll}
      >
        <AgentThreadTranscript
          transcript={transcript}
          runtimeState={runtimeState}
          parentRef={scrollContainerRef}
        />
        {agentThreadShowRawEventStream ? (
          <AgentThreadRawEventStream transcript={transcript} />
        ) : undefined}
      </div>
      {isAtBottom ? undefined : (
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 mx-auto flex max-w-6xl justify-end">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Scroll to bottom"
            className="pointer-events-auto shadow-xs"
            onClick={scrollToBottom}
          >
            <ArrowDown />
          </Button>
        </div>
      )}
    </div>
  );
}

function handleExplorerDragOver(event: DragEvent<HTMLElement>) {
  if (!event.dataTransfer.types.includes(explorerDragDataKey)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export { AgentThreadPanel };
