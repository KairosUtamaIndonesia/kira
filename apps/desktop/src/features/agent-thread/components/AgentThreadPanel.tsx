import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { explorerDragDataKey } from "@/features/explorer";
import { playAgentNotificationSound, useAppearanceTheme } from "@/features/settings";

import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";
import type {
  AgentThreadPanelParams,
  PiTranscriptState,
  RespondToHumanRequest,
  SessionTreeNodeJson,
} from "../types";

import { buildAgentThreadTranscript } from "../agentThreadDisplay";
import { clearAgentThreadDraft, setAgentThreadDraft } from "../agentThreadDraftStore";
import {
  clearPanelUnread,
  markPanelUnread,
  registerOpenAgentThread,
  setAgentThreadRuntimeState,
  unregisterOpenAgentThread,
} from "../agentThreadStatusStore";
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

function AgentThreadPanel({ api, params, onRename, isActive }: AgentThreadPanelProps) {
  const { agentThreadShowRawEventStream } = useAppearanceTheme();
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const handleAutoTitled = useCallback(
    async (title: string) => {
      api.setTitle(title);
      if (onRename !== undefined) {
        await onRename(params.panelId, title);
      }
    },
    [api, onRename, params.panelId],
  );
  const {
    compactionSummary,
    contextUsageState,
    currentLeafId,
    isCompacting,
    runSlashCommandAction,
    transcript,
    treeNodes,
    respondToRequest,
    runtimeState,
    sendPrompt,
    abortPrompt,
    navigateTree,
    switchModel,
  } = useAgentThreadConnection(params, { onAutoTitled: handleAutoTitled });

  const handleSendPrompt = useCallback(
    async (text: string): Promise<boolean> => {
      setEditingMessageId(undefined);
      return sendPrompt(text);
    },
    [sendPrompt],
  );

  const handleResend = useCallback(
    async (id: string, text: string): Promise<boolean> => {
      if (runtimeState.status !== "ready" && runtimeState.status !== "error") {
        return false;
      }
      // Find tree entry for this user message and navigate to its parent so the
      // resend becomes a sibling branch (the original sits off the active path
      // and is hidden by filterActivePathMessages), preventing a duplicate.
      const findNode = (nodes: SessionTreeNodeJson[]): SessionTreeNodeJson | undefined => {
        for (const node of nodes) {
          if (node.entry.messageId === id) {
            return node;
          }
          if (node.children.length > 0) {
            const found = findNode(node.children);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };
      const node = findNode(treeNodes);
      if (node !== undefined) {
        // Can't create a sibling branch from the root message — no parent to
        // branch from. The original root stays on the active path and the new
        // message creates a permanent duplicate.
        if (node.parentId === null) {
          return false;
        }
        if (node.parentId !== currentLeafId) {
          await navigateTree(node.parentId);
        }
      }
      // When the message has no tree node (historical, local, or tree not yet
      // loaded), skip navigation and send from the current position.
      setEditingMessageId(undefined);
      const ok = await sendPrompt(text);
      if (!ok) {
        toast.error("Failed to resend message");
      }
      return ok;
    },
    [treeNodes, navigateTree, sendPrompt, currentLeafId, runtimeState],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(undefined);
    clearAgentThreadDraft(params.threadId);
  }, [params.threadId]);

  const handleEdit = useCallback(
    (id: string, text: string) => {
      setEditingMessageId(id);
      setAgentThreadDraft(params.threadId, text, "inline");
    },
    [params.threadId],
  );
  const isEmpty = buildAgentThreadTranscript(transcript).length === 0;
  const prevRuntimeStateRef = useRef(runtimeState);
  useEffect(() => {
    const prevState = prevRuntimeStateRef.current;
    prevRuntimeStateRef.current = runtimeState;
    if (prevState.status !== "ready" && runtimeState.status === "ready") {
      registerOpenAgentThread({ threadId: params.threadId, panelId: params.panelId, title: "" });
    } else if (prevState.status !== "error" && runtimeState.status === "error") {
      unregisterOpenAgentThread(params.threadId);
    }
    if (prevState.status === "sending" && runtimeState.status === "ready" && isActive !== true) {
      void playAgentNotificationSound();
      markPanelUnread(params.panelId);
    }
  }, [runtimeState, params.threadId, params.panelId, isActive]);

  useEffect(() => {
    if (isActive === true) {
      clearPanelUnread(params.panelId);
    }
  }, [isActive, params.panelId]);

  useEffect(() => {
    setAgentThreadRuntimeState(params.threadId, runtimeState);
  }, [params.threadId, runtimeState]);

  useEffect(() => {
    setAgentThreadRuntimeState(
      params.panelId,
      runtimeState.status === "ready" ? { status: "stopped" } : runtimeState,
    );
  }, [params.panelId, runtimeState]);

  const treeContent = (() => {
    if (!isTreeOpen) return;
    if (treeNodes.length === 0) {
      return (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          No session tree data available. Start a conversation to build the tree.
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-border p-2">
        <div className="max-h-[60vh] overflow-y-auto">
          <SessionTree
            nodes={treeNodes}
            activePath={transcript.activePath}
            activeLeafId={transcript.activeLeafId}
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
        if (!event.dataTransfer.types.includes(explorerDragDataKey)) {
          return;
        }
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingFile(true);
      }}
      onDragLeave={(event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(explorerDragDataKey)) {
          return;
        }
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
          setIsDraggingFile(false);
        }
      }}
      onDragOver={handleExplorerDragOver}
      onDrop={(event: DragEvent<HTMLElement>) => {
        dragCounterRef.current = 0;
        setIsDraggingFile(false);
        if (event.defaultPrevented) {
          return;
        }
        const paths = explorerDropPaths(event.dataTransfer);
        if (paths.length === 0) {
          return;
        }
        event.preventDefault();
        setAgentThreadDraft(params.threadId, paths.map(fileReferenceText).join(""), "inline");
      }}
    >
      {/* Main content area — always full-width transcript */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <TranscriptArea
          transcript={transcript}
          compactionSummary={compactionSummary}
          isEmpty={isEmpty}
          editingMessageId={editingMessageId}
          respondToRequest={respondToRequest}
          agentThreadShowRawEventStream={agentThreadShowRawEventStream}
          onResend={handleResend}
          onEdit={handleEdit}
          runtimeState={runtimeState}
        />
      </div>
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
          {treeContent}
          <AgentActionIndicator runtimeState={runtimeState} isCompacting={isCompacting} />
          <Composer
            threadId={params.threadId}
            folderPath={params.folderPath}
            runtimeState={runtimeState}
            contextUsageState={contextUsageState}
            isCompacting={isCompacting}
            sendPrompt={handleSendPrompt}
            runSlashCommandAction={runSlashCommandAction}
            switchModel={switchModel}
            isDropTargetActive={isDraggingFile}
            editingMessageId={editingMessageId}
            abortPrompt={abortPrompt}
            onCancelEdit={handleCancelEdit}
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
  compactionSummary: { tokensBefore: number; summary: string } | undefined;
  isEmpty: boolean;
  editingMessageId: string | undefined;
  respondToRequest: RespondToHumanRequest;
  agentThreadShowRawEventStream: boolean;
  onResend: (id: string, text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => void;
  runtimeState: AgentThreadRuntimeState;
};

function TranscriptArea({
  transcript,
  compactionSummary,
  isEmpty,
  editingMessageId,
  respondToRequest,
  agentThreadShowRawEventStream,
  onResend,
  onEdit,
  runtimeState,
}: TranscriptAreaProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollApiRef = useRef<{
    scrollToIndex: (
      index: number,
      options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior },
    ) => void;
  } | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el === null) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);
  // Auto-scroll when content grows (e.g., streaming response) and user is at bottom.
  // ResizeObserver on the virtual list container detects height changes from
  // growing content within existing items (not just new items being added).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container === null) return;
    const target = container.firstElementChild;
    if (target === null) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isEmpty]);

  // Auto-scroll to bottom when new items arrive and user was already at bottom
  const handleHeightChange = useCallback(() => {
    if (isAtBottomRef.current && scrollApiRef.current !== null) {
      const api = scrollApiRef.current;
      // Use setTimeout to let the virtualizer update its measurements first
      setTimeout(() => {
        api.scrollToIndex(Infinity, { align: "end" });
      }, 0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollApiRef.current !== null) {
      scrollApiRef.current.scrollToIndex(Infinity, { align: "end", behavior: "smooth" });
    }
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        className={`min-h-0 flex-1 overflow-y-auto ${isEmpty ? "flex items-center justify-center p-2" : "p-2"}`}
        onScroll={handleScroll}
      >
        <AgentThreadTranscript
          transcript={transcript}
          compactionSummary={compactionSummary}
          editingMessageId={editingMessageId}
          respond={respondToRequest}
          onResend={onResend}
          onEdit={onEdit}
          runtimeState={runtimeState}
          parentRef={scrollContainerRef}
          onHeightChange={handleHeightChange}
          onVirtualizerReady={(api) => {
            scrollApiRef.current = api;
          }}
        />
        {agentThreadShowRawEventStream ? (
          <AgentThreadRawEventStream transcript={transcript} />
        ) : undefined}
      </div>
      {isAtBottom ? undefined : (
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 mx-auto flex max-w-5xl justify-end">
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
  if (!event.dataTransfer.types.includes(explorerDragDataKey)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export { AgentThreadPanel };
