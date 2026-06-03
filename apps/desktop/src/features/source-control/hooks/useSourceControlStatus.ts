import { useCallback, useEffect, useState } from "react";

import type { SourceControlStatusResult } from "../types";

import { getSourceControlStatus } from "../api/sourceControlApi";

type SourceControlStatusState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SourceControlStatusResult }
  | { status: "error"; message: string };

function useSourceControlStatus(folderPath: string | undefined) {
  const [state, setState] = useState<SourceControlStatusState>({ status: "idle" });

  const refresh = useCallback(async () => {
    if (folderPath === undefined) {
      setState({ status: "idle" });
      return;
    }

    setState((currentState) =>
      currentState.status === "ready" ? currentState : { status: "loading" },
    );

    try {
      const result = await getSourceControlStatus({ folderPath });
      setState({ status: "ready", result });
    } catch (error) {
      setState({ status: "error", message: errorMessageFromUnknown(error) });
    }
  }, [folderPath]);

  useEffect(() => {
    let ignoreResult = false;

    async function loadStatus() {
      if (folderPath === undefined) {
        setState({ status: "idle" });
        return;
      }

      setState({ status: "loading" });
      try {
        const result = await getSourceControlStatus({ folderPath });
        if (!ignoreResult) {
          setState({ status: "ready", result });
        }
      } catch (error) {
        if (!ignoreResult) {
          setState({ status: "error", message: errorMessageFromUnknown(error) });
        }
      }
    }

    void loadStatus();

    return () => {
      ignoreResult = true;
    };
  }, [folderPath]);

  return { state, refresh };
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load source control status.";
}

export { useSourceControlStatus };
export type { SourceControlStatusState };
