import { Spinner } from "@/components/ui/spinner";

import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";

type AgentActionIndicatorProps = {
  runtimeState: AgentThreadRuntimeState | undefined;
  isCompacting: boolean;
};

function AgentActionIndicator({ runtimeState, isCompacting }: AgentActionIndicatorProps) {
  const text = actionText(runtimeState, isCompacting);
  if (text === undefined) {
    return;
  }

  return (
    <div aria-live="polite" className="flex items-center gap-1.5 px-1 py-1">
      <Spinner variant="bars" size={12} className="text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
}

function actionText(
  runtimeState: AgentThreadRuntimeState | undefined,
  isCompacting: boolean,
): string | undefined {
  if (isCompacting) {
    return "Compacting…";
  }
  if (runtimeState === undefined) {
    return undefined;
  }
  switch (runtimeState.status) {
    case "starting":
      return "Starting…";
    case "connecting":
      return "Connecting…";
    case "sending":
      return "Working…";
    default:
      return undefined;
  }
}

export { AgentActionIndicator };
