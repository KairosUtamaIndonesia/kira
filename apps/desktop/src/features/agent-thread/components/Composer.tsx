import { CornerDownLeft, Loader2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";

import { clearAgentThreadDraft, useAgentThreadDraft } from "../agentThreadDraftStore";

type ComposerProps = {
  threadId: string;
  runtimeState: AgentThreadRuntimeState;
  sendPrompt: (prompt: string) => Promise<boolean>;
};

function Composer({ threadId, runtimeState, sendPrompt }: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consumedDraftSequenceRef = useRef(0);
  const draft = useAgentThreadDraft(threadId);
  const canSend = runtimeState.status === "ready" || runtimeState.status === "sending";
  const isSending = runtimeState.status === "sending";
  const isDisabled = !canSend || isSending;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea instanceof HTMLTextAreaElement) {
      resizeComposerTextarea(textarea);
    }
  }, [prompt]);

  useEffect(() => {
    if (draft === undefined || draft.sequence === consumedDraftSequenceRef.current) {
      return;
    }
    consumedDraftSequenceRef.current = draft.sequence;
    setPrompt((current) =>
      current.trim().length > 0 ? `${current}\n\n${draft.text}` : draft.text,
    );
    clearAgentThreadDraft(threadId);
    const textarea = textareaRef.current;
    if (textarea !== null) {
      textarea.focus();
    }
  }, [draft, threadId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (message.length === 0) {
      return;
    }

    const sent = await sendPrompt(message);
    if (sent) {
      setPrompt("");
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <div
        className={cn(
          "relative rounded-sm border border-input bg-transparent pr-10 transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          isDisabled && "pointer-events-none opacity-50",
        )}
      >
        <textarea
          ref={textareaRef}
          value={prompt}
          rows={1}
          aria-label="Prompt"
          placeholder="Send a prompt to this Agent Thread…"
          disabled={isDisabled}
          className="block min-h-9 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(event) => handlePromptChange(event, setPrompt)}
          onKeyDown={handlePromptKeyDown}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={sendButtonLabel(runtimeState)}
          disabled={!canSend || isSending || prompt.trim().length === 0}
          className="absolute right-1.5 bottom-1.5 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {isSending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <CornerDownLeft aria-hidden="true" />
          )}
        </Button>
      </div>
    </form>
  );
}

function handlePromptChange(
  event: ChangeEvent<HTMLTextAreaElement>,
  setPrompt: (prompt: string) => void,
) {
  resizeComposerTextarea(event.currentTarget);
  setPrompt(event.currentTarget.value);
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement) {
  const maxHeight = maxComposerTextareaHeight();
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function maxComposerTextareaHeight() {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (Number.isNaN(rootFontSize)) {
    throw new Error("Unable to resolve root font size for Composer textarea sizing.");
  }

  return rootFontSize * 12;
}

function sendButtonLabel(state: AgentThreadRuntimeState) {
  if (state.status === "starting" || state.status === "connecting") {
    return "Starting…";
  }

  if (state.status === "sending") {
    return "Sending…";
  }

  return "Send";
}

function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  const form = event.currentTarget.form;
  if (form instanceof HTMLFormElement) {
    form.requestSubmit();
  }
}

export { Composer };
