import { Loader2 } from "lucide-react";

import { useAppearanceTheme } from "@/features/settings";

import type { AgentThreadPanelParams } from "../types";

import {
  useAgentThreadConnection,
  type AgentThreadRuntimeState,
} from "../hooks/useAgentThreadConnection";
import { AgentThreadContextMeter } from "./AgentThreadContextMeter";
import { AgentThreadRawEventStream } from "./AgentThreadRawEventStream";
import { AgentThreadTranscript } from "./AgentThreadTranscript";
import { Composer } from "./Composer";

type AgentThreadPanelProps = {
  params: AgentThreadPanelParams;
};

function AgentThreadPanel({ params }: AgentThreadPanelProps) {
  const { agentThreadShowRawEventStream } = useAppearanceTheme();
  const { contextUsageState, messages, runtimeState, sendPrompt } =
    useAgentThreadConnection(params);

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-2 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Agent Thread</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{params.threadId}</div>
        </div>
        <AgentThreadStatus state={runtimeState} />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="mx-auto w-full max-w-5xl">
          <AgentThreadTranscript
            messages={messages}
            runtimeIsSending={runtimeState.status === "sending"}
          />
          {agentThreadShowRawEventStream ? (
            <AgentThreadRawEventStream messages={messages} />
          ) : undefined}
        </div>
      </div>
      <footer className="relative shrink-0 bg-editor-surface p-2 before:pointer-events-none before:absolute before:-top-8 before:right-0 before:left-0 before:h-8 before:bg-gradient-to-t before:from-editor-surface before:to-transparent before:content-['']">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
          <Composer runtimeState={runtimeState} sendPrompt={sendPrompt} />
          <AgentThreadContextMeter state={contextUsageState} />
        </div>
      </footer>
    </section>
  );
}

function AgentThreadStatus({ state }: { state: AgentThreadRuntimeState }) {
  if (state.status === "starting") {
    return (
      <output className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Starting runtime…
      </output>
    );
  }

  if (state.status === "connecting") {
    return (
      <output className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Connecting…
      </output>
    );
  }

  if (state.status === "ready" || state.status === "sending") {
    return (
      <output className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        {state.baseUrl}
      </output>
    );
  }

  if (state.status === "error") {
    return (
      <output
        role="alert"
        className="max-w-80 truncate rounded-full border border-border px-2 py-1 text-xs text-destructive"
      >
        {state.message}
      </output>
    );
  }

  return (
    <output className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
      Stopped
    </output>
  );
}

export { AgentThreadPanel };
