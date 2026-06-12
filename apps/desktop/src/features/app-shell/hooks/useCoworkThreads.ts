import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing } from "@/features/projects/types";

import { listCoworkAgentThreadPanels } from "@/features/projects/api/projectsApi";

// The Cowork shell's conversation list: threads are the first-class citizen,
// most recent first; their backing Cowork projects stay invisible. Snapshot
// on mount plus manual refresh matches the sidebar data-fetching pattern used
// by the Code shell (AppSidebar).

type CoworkThreadsState =
  | { status: "loading" }
  | { status: "ready"; threads: AgentThreadPanelListing[] }
  | { status: "error"; message: string };

function useCoworkThreads() {
  const [state, setState] = useState<CoworkThreadsState>({ status: "loading" });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const threads = await listCoworkAgentThreadPanels();
      if (requestIdRef.current === requestId) {
        setState({ status: "ready", threads });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState({ status: "error", message: errorMessageFromUnknown(error) });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      // Invalidate in-flight requests so an unmounted hook never sets state.
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load conversations.";
}

export { useCoworkThreads };
export type { CoworkThreadsState };
