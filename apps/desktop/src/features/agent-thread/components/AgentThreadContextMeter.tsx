import type { ReactNode } from "react";

import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";

import type { AgentThreadContextUsageState } from "../hooks/useAgentThreadConnection";

type AgentThreadContextMeterProps = {
  state: AgentThreadContextUsageState;
};

function AgentThreadContextMeter({ state }: AgentThreadContextMeterProps) {
  if (state.status === "loading") {
    return <ContextMeterText>Loading context usage…</ContextMeterText>;
  }

  if (state.status === "empty") {
    return <ContextMeterText>Context usage appears after the first run.</ContextMeterText>;
  }

  if (state.status === "error") {
    return <ContextMeterText>Context usage unavailable: {state.message}</ContextMeterText>;
  }

  const usage = state.usage;
  return (
    <div className="flex justify-end">
      <Context
        usedTokens={usage.usedTokens}
        maxTokens={usage.contextWindow}
        modelId={usage.modelId}
        costUsd={usage.cost ? usage.cost.total : 0}
      >
        <ContextTrigger className="h-6 gap-1.5 px-1.5 text-xs" />
        <ContextContent align="end" className="text-xs">
          <ContextContentHeader />
          <ContextContentBody className="space-y-2">
            <ContextInputUsage />
            <ContextOutputUsage />
            <ContextReasoningUsage />
            <ContextCacheUsage />
          </ContextContentBody>
          <ContextContentFooter />
        </ContextContent>
      </Context>
    </div>
  );
}

function ContextMeterText({ children }: { children: ReactNode }) {
  return <div className="flex justify-end text-xs text-muted-foreground">{children}</div>;
}

export { AgentThreadContextMeter };
