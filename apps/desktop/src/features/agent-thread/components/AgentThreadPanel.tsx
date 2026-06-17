import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { StickToBottom } from "use-stick-to-bottom";

import { Button } from "@/components/ui/button";
import { explorerDragDataKey } from "@/features/explorer";
import { playAgentNotificationSound, useAppearanceTheme } from "@/features/settings";

import type {
  AgentThreadPanelParams,
  PiTranscriptState,
  RespondToHumanRequest,
  SessionTreeNodeJson,
} from "../types";

import { buildAgentThreadTranscript } from "../agentThreadDisplay";
import { clearAgentThreadDraft, setAgentThreadDraft } from "../agentThreadDraftStore";
import {
  registerOpenAgentThread,
  setAgentThreadRuntimeState,
  unregisterOpenAgentThread,
} from "../agentThreadStatusStore";
import { explorerDropPaths, fileReferenceText } from "../explorerDropUtils";
import { useAgentThreadConnection } from "../hooks/useAgentThreadConnection";
import { AgentThreadRawEventStream } from "./AgentThreadRawEventStream";
import { AgentThreadTranscript } from "./AgentThreadTranscript";
import { Composer } from "./Composer";
import { SessionTree } from "./SessionTree";

type AgentThreadPanelProps = {
  api: { setTitle(title: string): void };
  params: AgentThreadPanelParams;
  initialPrompt?: string;
  onRename?: (panelId: string, title: string) => Promise<void>;
};

function AgentThreadPanel({ api, params, onRename }: AgentThreadPanelProps) {
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
    isCompacting,
    runSlashCommandAction,
    transcript,
    treeNodes,
    respondToRequest,
    runtimeState,
    sendPrompt,
    navigateTree,
  } = useAgentThreadConnection(params, { onAutoTitled: handleAutoTitled });

  const handleSendPrompt = useCallback(
    async (text: string): Promise<boolean> => {
      setEditingMessageId(undefined);
      return sendPrompt(text);
    },
    [sendPrompt],
  );

  const handleResend = useCallback(
    (id: string, text: string) => {
      // Find tree entry for this user message and navigate to its parent.
      const findEntryId = (nodes: SessionTreeNodeJson[]): string | undefined => {
        for (const node of nodes) {
          if (node.entry.messageId === id) {
            return node.id;
          }
          if (node.children.length > 0) {
            const found = findEntryId(node.children);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };
      const entryId = findEntryId(treeNodes);
      if (entryId !== undefined) {
        void navigateTree(entryId);
      }
      setEditingMessageId(undefined);
      sendPrompt(text);
    },
    [treeNodes, navigateTree, sendPrompt],
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
    if (prevState.status === "sending" && runtimeState.status === "ready") {
      void playAgentNotificationSound();
    }
  }, [runtimeState, params.threadId, params.panelId]);

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
      className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground"
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
        />
      </div>
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
          {treeContent}
          <Composer
            threadId={params.threadId}
            folderPath={params.folderPath}
            runtimeState={runtimeState}
            contextUsageState={contextUsageState}
            isCompacting={isCompacting}
            sendPrompt={handleSendPrompt}
            runSlashCommandAction={runSlashCommandAction}
            isDropTargetActive={isDraggingFile}
            editingMessageId={editingMessageId}
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
  onResend: (id: string, text: string) => void;
  onEdit: (id: string, text: string) => void;
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
}: TranscriptAreaProps) {
  return (
    <StickToBottom className="relative min-h-0 flex-1" initial="instant" resize="smooth">
      {({ isAtBottom, scrollToBottom }) => (
        <>
          <StickToBottom.Content
            className={isEmpty ? "mx-auto h-full w-full max-w-5xl" : "mx-auto w-full max-w-5xl"}
            scrollClassName={isEmpty ? "p-2 h-full" : "p-2"}
          >
            <AgentThreadTranscript
              transcript={transcript}
              compactionSummary={compactionSummary}
              editingMessageId={editingMessageId}
              respond={respondToRequest}
              onResend={onResend}
              onEdit={onEdit}
            />
            {agentThreadShowRawEventStream ? (
              <AgentThreadRawEventStream transcript={transcript} />
            ) : undefined}
          </StickToBottom.Content>
          {isAtBottom ? undefined : (
            <div className="pointer-events-none absolute right-4 bottom-4 left-4 mx-auto flex max-w-5xl justify-end">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Scroll to bottom"
                className="pointer-events-auto shadow-xs"
                onClick={() => {
                  void scrollToBottom({ animation: "smooth" });
                }}
              >
                <ArrowDown />
              </Button>
            </div>
          )}
        </>
      )}
    </StickToBottom>
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
