import { Loader2 } from "lucide-react";

import type { AgentThreadRuntimeState } from "@/features/agent-thread/hooks/useAgentThreadConnection";

import { useAgentThreadRuntimeState } from "@/features/agent-thread/agentThreadStatusStore";

import type { ActiveWorkspaceState } from "../types";

type AppStatusBarProps = {
  activeWorkspace: ActiveWorkspaceState;
};

function AppStatusBar({ activeWorkspace }: AppStatusBarProps) {
  const agentThreadRuntimeState = useAgentThreadRuntimeState();

  return (
    <footer className="flex items-center justify-between bg-background px-3 text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>{statusLabel(activeWorkspace)}</span>
        <AgentThreadStatusIndicator state={agentThreadRuntimeState} />
      </div>
      <span>Kira v3</span>
    </footer>
  );
}

function AgentThreadStatusIndicator({ state }: { state: AgentThreadRuntimeState | undefined }) {
  if (state === undefined) {
    return;
  }

  if (state.status === "starting") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Agent runtime starting…
      </span>
    );
  }

  if (state.status === "connecting") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Agent runtime connecting…
      </span>
    );
  }

  if (state.status === "ready" || state.status === "sending") {
    return (
      <span className="text-xs text-muted-foreground">
        {state.status === "sending" ? (
          <span className="flex items-center gap-1">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            {state.baseUrl}
          </span>
        ) : (
          state.baseUrl
        )}
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span className="max-w-80 truncate text-xs text-destructive" role="alert">
        {state.message}
      </span>
    );
  }

  if (state.status === "stopped") {
    return;
  }

  return;
}

function statusLabel(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "active") {
    if (activeWorkspace.projectSwitch.status === "switching") {
      return `Switching project from ${activeWorkspace.project.name}…`;
    }

    if (activeWorkspace.projectSwitch.status === "error") {
      return `Project: ${activeWorkspace.project.name} · Switch failed`;
    }

    return `Project: ${activeWorkspace.project.name}`;
  }

  if (activeWorkspace.status === "loading") {
    return "Opening project…";
  }

  if (activeWorkspace.status === "error") {
    return "Project open failed";
  }

  return "No Project";
}

export { AppStatusBar };
