import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { StickToBottom } from "use-stick-to-bottom";

import { Button } from "@/components/ui/button";
import { explorerDragDataKey } from "@/features/explorer";
import { useAppearanceTheme } from "@/features/settings";

import type { AgentThreadPanelParams } from "../types";

import { setAgentThreadDraft } from "../agentThreadDraftStore";
import {
  registerOpenAgentThread,
  setAgentThreadRuntimeState,
  unregisterOpenAgentThread,
} from "../agentThreadStatusStore";
import { explorerDropPaths, fileReferenceText } from "../explorerDropUtils";
import { useAgentThreadConnection } from "../hooks/useAgentThreadConnection";
import { AgentThreadContextMeter } from "./AgentThreadContextMeter";
import { AgentThreadRawEventStream } from "./AgentThreadRawEventStream";
import { AgentThreadTranscript } from "./AgentThreadTranscript";
import { Composer } from "./Composer";

type AgentThreadPanelProps = {
  api: { setTitle(title: string): void };
  params: AgentThreadPanelParams;
  onRename?: (panelId: string, title: string) => Promise<void>;
};

function AgentThreadPanel({ api, params, onRename }: AgentThreadPanelProps) {
  const { agentThreadShowRawEventStream } = useAppearanceTheme();
  const dragCounterRef = useRef(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const handleAutoTitled = useCallback(
    async (title: string) => {
      if (onRename === undefined) {
        return;
      }
      try {
        await onRename(params.panelId, title);
        api.setTitle(title);
      } catch {
        // Title generation is cosmetic; do not surface errors.
      }
    },
    [api, onRename, params.panelId],
  );

  const {
    contextUsageState,
    isCompacting,
    runSlashCommandAction,
    transcript,
    respondToRequest,
    runtimeState,
    sendPrompt,
  } = useAgentThreadConnection(params, { onAutoTitled: handleAutoTitled });

  useEffect(() => {
    setAgentThreadRuntimeState(params.threadId, runtimeState);
    return () => setAgentThreadRuntimeState(params.threadId, undefined);
  }, [params.threadId, runtimeState]);

  useEffect(() => {
    registerOpenAgentThread({
      threadId: params.threadId,
      panelId: params.panelId,
      title: params.title,
    });
    return () => unregisterOpenAgentThread(params.threadId);
  }, [params.threadId, params.panelId, params.title]);

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
        // When Composer handles the drop itself it calls event.preventDefault().
        // Skip setAgentThreadDraft to avoid double-insertion; just clean up drag state.
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
      <StickToBottom className="relative min-h-0 flex-1" initial="instant" resize="smooth">
        {({ isAtBottom, scrollToBottom }) => (
          <>
            <StickToBottom.Content className="mx-auto w-full max-w-5xl" scrollClassName="p-2">
              <AgentThreadTranscript transcript={transcript} respond={respondToRequest} />
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
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
          <Composer
            threadId={params.threadId}
            folderPath={params.folderPath}
            runtimeState={runtimeState}
            isCompacting={isCompacting}
            sendPrompt={sendPrompt}
            runSlashCommandAction={runSlashCommandAction}
            isDropTargetActive={isDraggingFile}
          />
          <AgentThreadContextMeter state={contextUsageState} />
        </div>
      </footer>
    </section>
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
