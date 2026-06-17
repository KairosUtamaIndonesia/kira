import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SourceControlProjectInput } from "../types";

type GenerateCommitMessageInput = {
  folderPath: string;
};

export function useCommitMessageGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>();
  // eslint-disable-next-line unicorn/no-useless-undefined — required: no overload for useRef<T>()
  const abortRef = useRef<AbortController | undefined>(undefined);

  // Abort in-flight generation on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const generate = useCallback(
    async (input: SourceControlProjectInput): Promise<string | undefined> => {
      setIsGenerating(true);
      setError(undefined);

      // Cancel any previous in-flight invocation
      if (abortRef.current) abortRef.current.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const commitMessage = await invoke<string>("generate_commit_message", {
          input: { folderPath: input.folderPath } satisfies GenerateCommitMessageInput,
        });

        if (abortController.signal.aborted) {
          return undefined;
        }

        return commitMessage;
      } catch (err) {
        if (abortController.signal.aborted) {
          return undefined;
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return undefined;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(undefined), []);

  return { generate, isGenerating, error, clearError };
}
