import { useCallback, useEffect } from "react";

import { useAppearanceTheme } from "@/features/settings";

import type { AgentThreadPanelParams } from "../types";

import {
  registerOpenAgentThread,
  setAgentThreadRuntimeState,
  unregisterOpenAgentThread,
} from "../agentThreadStatusStore";
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

  const { contextUsageState, transcript, respondToRequest, runtimeState, sendPrompt } =
    useAgentThreadConnection(params, { onAutoTitled: handleAutoTitled });

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
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="mx-auto w-full max-w-5xl">
          <AgentThreadTranscript transcript={transcript} respond={respondToRequest} />
          {agentThreadShowRawEventStream ? (
            <AgentThreadRawEventStream transcript={transcript} />
          ) : undefined}
        </div>
      </div>
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
          <Composer
            threadId={params.threadId}
            runtimeState={runtimeState}
            sendPrompt={sendPrompt}
          />
          <AgentThreadContextMeter state={contextUsageState} />
        </div>
      </footer>
    </section>
  );
}

export { AgentThreadPanel };
