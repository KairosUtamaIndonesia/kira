import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSocket } from "@/features/agent-thread/AppSocketProvider";
import { requestOverSocket } from "@/features/agent-thread/socketRequest";

import type { SourceControlProjectInput } from "../types";


export function useCommitMessageGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>();
  // eslint-disable-next-line unicorn/no-useless-undefined — required: no overload for useRef<T>()
  const abortRef = useRef<AbortController | undefined>(undefined);
  const socket = useAppSocket();

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
        const git = await invoke<{ stagedDiff: string; recentLog: string }>(
          "source_control_staged_diff_log",
          { input: { folderPath: input.folderPath } },
        );

        if (abortController.signal.aborted) {
          return undefined;
        }

        const requestId = crypto.randomUUID();

        const commitMessage = await requestOverSocket<string>(
          socket.send,
          socket.onEvent,
          {
            type: "generate_commit_message",
            requestId,
            stagedDiff: git.stagedDiff,
            recentLog: git.recentLog,
          },
          (event) => {
            if (event.type === "commit_message_generated" && event.requestId === requestId) {
              return event.commitMessage;
            }
            if (event.type === "commit_message_generation_failed" && event.requestId === requestId) {
              throw new Error(event.error);
            }
            return;
          },
          { signal: abortController.signal },
        );

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
    [socket],
  );

  const clearError = useCallback(() => setError(undefined), []);

  return { generate, isGenerating, error, clearError };
}
