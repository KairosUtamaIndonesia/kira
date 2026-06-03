import { useCallback, useEffect, useState } from "react";

import type { ExplorerTreeResult } from "../types";

import { getExplorerTree } from "../api/explorerApi";

type ExplorerTreeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: ExplorerTreeResult }
  | { status: "error"; message: string };

function useExplorerTree(folderPath: string | undefined) {
  const [state, setState] = useState<ExplorerTreeState>({ status: "idle" });
  const [refreshSequence, setRefreshSequence] = useState(0);

  const refresh = useCallback(() => {
    setRefreshSequence((currentSequence) => currentSequence + 1);
  }, []);

  useEffect(() => {
    if (folderPath === undefined) {
      setState({ status: "idle" });
      return;
    }

    const projectFolderPath = folderPath;
    let ignoreResult = false;
    setState({ status: "loading" });

    async function loadTree() {
      try {
        const result = await getExplorerTree({ folderPath: projectFolderPath });
        if (!ignoreResult) {
          setState({ status: "ready", result });
        }
      } catch (error) {
        if (!ignoreResult) {
          setState({ status: "error", message: errorMessageFromUnknown(error) });
        }
      }
    }

    void loadTree();

    return () => {
      ignoreResult = true;
    };
  }, [folderPath, refreshSequence]);

  return { state, refresh };
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load Explorer.";
}

export { useExplorerTree };
