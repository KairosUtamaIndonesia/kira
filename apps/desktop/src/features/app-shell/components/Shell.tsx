import { useEffect } from "react";

import { toast } from "@/components/ui/sonner";
import { startAgentRuntime } from "@/features/agent-thread/api/agentRuntimeApi";

import { useModeStore } from "../state/modeStore";
import { AppShell } from "./AppShell";
import { CoworkShell } from "./CoworkShell";

// Renders the layout for the current App Shell mode. Both shells share the
// same data model and Tauri commands; switching is a layout change only.
function Shell() {
  const mode = useModeStore((state) => state.mode);

  // The agent runtime serves both shells, so it starts here rather than
  // inside either shell (a mode switch must not restart it).
  useEffect(() => {
    async function startRuntime() {
      try {
        await startAgentRuntime();
      } catch (error) {
        toast.error(`Agent runtime failed to start: ${startRuntimeErrorMessage(error)}`);
      }
    }

    void startRuntime();
  }, []);

  if (mode === "code") {
    return <AppShell />;
  }

  return <CoworkShell />;
}

function startRuntimeErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

export { Shell };
