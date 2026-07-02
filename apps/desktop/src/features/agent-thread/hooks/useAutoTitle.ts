import type { AgentMessage } from "@kira/agent-pi/protocol";

import { useRef, useState } from "react";

import { setAgentThreadTitleGenerationState } from "../agentThreadStatusStore";
import { generateAgentThreadTitle } from "../api/agentRuntimeApi";
import { textOfMessage } from "../piTranscriptState";

type AgentThreadTitleGenerationState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "done" };

type UseAutoTitleInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
  title: string;
  onAutoTitled: ((title: string) => void | Promise<void>) | undefined;
};

const minimumTitleGenerationVisibleMs = 1200;
const maxImmediateTitleLength = 50;

/**
 * Auto-titles an untitled Agent Thread from its first prompt: short prompts
 * become the title immediately on {@link arm}; longer ones generate a title
 * from the model once {@link settle} sees the run's final assistant message.
 */
function useAutoTitle(input: UseAutoTitleInput) {
  const [titleGenerationState, setTitleGenerationState] = useState<AgentThreadTitleGenerationState>(
    { status: "idle" },
  );
  const hasAutoTitledRef = useRef(false);
  /** Prompt awaiting its settled run; consumed by title generation. */
  const pendingPromptRef = useRef<string | undefined>(void 0);
  const onAutoTitledRef = useRef(input.onAutoTitled);
  onAutoTitledRef.current = input.onAutoTitled;

  /** Call when a prompt is accepted. First prompt on an untitled thread wins. */
  function arm(message: string) {
    if (hasAutoTitledRef.current || !isUntitledAgentThreadTitle(input.title)) {
      return;
    }
    const trimmedPrompt = message.trim();
    if (trimmedPrompt.length <= maxImmediateTitleLength) {
      hasAutoTitledRef.current = true;
      const onAutoTitled = onAutoTitledRef.current;
      if (onAutoTitled !== undefined) {
        void onAutoTitled(trimmedPrompt);
      }
    } else if (pendingPromptRef.current === undefined) {
      pendingPromptRef.current = trimmedPrompt;
    }
  }

  /** Call with the settled run's messages (`agent_end`, `willRetry: false`). */
  function settle(messages: AgentMessage[]) {
    const prompt = pendingPromptRef.current;
    if (prompt === undefined) {
      return;
    }
    pendingPromptRef.current = undefined;
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage === undefined ||
      lastMessage.role !== "assistant" ||
      !("stopReason" in lastMessage) ||
      lastMessage.stopReason === "error" ||
      lastMessage.stopReason === "aborted"
    ) {
      return;
    }
    void generateTitleFromModel(prompt, textOfMessage(lastMessage));
  }

  async function generateTitleFromModel(prompt: string, assistantText: string) {
    if (hasAutoTitledRef.current || assistantText.length === 0) {
      return;
    }

    setTitleGenerationState({ status: "generating" });
    setAgentThreadTitleGenerationState(input.threadId, { status: "generating" });
    const generationStartedAt = performance.now();
    let generatedTitle = "";

    try {
      generatedTitle = await generateAgentThreadTitle({
        projectId: input.projectId,
        sessionId: input.sessionId,
        threadId: input.threadId,
        prompt,
        assistantText,
      });
    } catch {
      // Title generation is cosmetic; silently fail.
    }

    await waitForMinimumTitleGenerationDuration(generationStartedAt);
    if (generatedTitle.length > 0 && !hasAutoTitledRef.current) {
      hasAutoTitledRef.current = true;
      const onAutoTitled = onAutoTitledRef.current;
      if (onAutoTitled !== undefined) {
        await onAutoTitled(generatedTitle);
      }
    }
    setTitleGenerationState({ status: "done" });
    setAgentThreadTitleGenerationState(input.threadId, { status: "done" });
  }

  return { titleGenerationState, arm, settle };
}

function isUntitledAgentThreadTitle(title: string) {
  return title === "New Thread" || title === "Agent Thread";
}

async function waitForMinimumTitleGenerationDuration(startedAt: number) {
  const remainingMs = minimumTitleGenerationVisibleMs - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, remainingMs);
  await promise;
}

export { useAutoTitle };
export type { AgentThreadTitleGenerationState };
