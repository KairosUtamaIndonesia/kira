import { CornerDownLeft, Loader2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type { ExplorerFileReferenceSuggestion } from "@/features/explorer/types";

import { Button } from "@/components/ui/button";
import { getExplorerFileReferenceSuggestions } from "@/features/explorer/api/explorerApi";
import { cn } from "@/lib/utils";

import type { AgentThreadRuntimeState } from "../hooks/useAgentThreadConnection";

import { clearAgentThreadDraft, useAgentThreadDraft } from "../agentThreadDraftStore";

type ComposerProps = {
  threadId: string;
  folderPath: string;
  runtimeState: AgentThreadRuntimeState;
  sendPrompt: (prompt: string) => Promise<boolean>;
};

type FileReferenceToken = {
  start: number;
  end: number;
  query: string;
  isQuoted: boolean;
};

type FileReferencePickerState =
  | { status: "closed" }
  | { status: "loading"; token: FileReferenceToken; selectedIndex: number }
  | {
      status: "ready";
      token: FileReferenceToken;
      suggestions: ExplorerFileReferenceSuggestion[];
      selectedIndex: number;
    }
  | { status: "empty"; token: FileReferenceToken }
  | { status: "error"; token: FileReferenceToken; message: string };

const fileReferenceSuggestionLimit = 20;

function Composer({ threadId, folderPath, runtimeState, sendPrompt }: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [pickerState, setPickerState] = useState<FileReferencePickerState>({ status: "closed" });
  const [cursorSequence, setCursorSequence] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consumedDraftSequenceRef = useRef(0);
  const requestSequenceRef = useRef(0);
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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null || document.activeElement !== textarea) {
      setPickerState({ status: "closed" });
      return;
    }

    const token = extractFileReferenceToken(prompt, textarea.selectionStart, textarea.selectionEnd);
    if (token === undefined) {
      setPickerState({ status: "closed" });
      return;
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setPickerState((current) => ({
      status: "loading",
      token,
      selectedIndex:
        current.status === "ready" || current.status === "loading" ? current.selectedIndex : 0,
    }));

    const timeoutId = window.setTimeout(() => {
      void loadFileReferenceSuggestions({
        folderPath,
        requestId,
        requestSequenceRef,
        setPickerState,
        token,
      });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [cursorSequence, folderPath, prompt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pickerState.status === "ready") {
      const suggestion = pickerState.suggestions[pickerState.selectedIndex];
      if (suggestion !== undefined) {
        acceptFileReferenceSuggestion(suggestion, pickerState.token);
        return;
      }
    }

    const message = prompt.trim();
    if (message.length === 0) {
      return;
    }

    const sent = await sendPrompt(message);
    if (sent) {
      setPrompt("");
      setPickerState({ status: "closed" });
    }
  }

  function acceptFileReferenceSuggestion(
    suggestion: ExplorerFileReferenceSuggestion,
    token: FileReferenceToken,
  ) {
    const completion = fileReferenceCompletion(suggestion.path, token, suggestion.kind);
    const afterToken = prompt.slice(token.end);
    const adjustedAfterToken =
      token.isQuoted && afterToken.startsWith('"') && completion.text.includes('"')
        ? afterToken.slice(1)
        : afterToken;
    const nextPrompt = `${prompt.slice(0, token.start)}${completion.text}${adjustedAfterToken}`;
    setPrompt(nextPrompt);
    setPickerState(
      suggestion.kind === "directory"
        ? { status: "loading", token, selectedIndex: 0 }
        : { status: "closed" },
    );
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }
      textarea.focus();
      const cursor = token.start + completion.cursorOffset;
      textarea.setSelectionRange(cursor, cursor);
      resizeComposerTextarea(textarea);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && pickerState.status !== "closed") {
      event.preventDefault();
      setPickerState({ status: "closed" });
      return;
    }

    if (pickerState.status === "ready") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setPickerState({
          ...pickerState,
          selectedIndex: wrapIndex(
            pickerState.selectedIndex + direction,
            pickerState.suggestions.length,
          ),
        });
        return;
      }

      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        const suggestion = pickerState.suggestions[pickerState.selectedIndex];
        if (suggestion !== undefined) {
          event.preventDefault();
          acceptFileReferenceSuggestion(suggestion, pickerState.token);
          return;
        }
      }
    }

    handlePromptKeyDown(event);
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
        <FileReferencePicker state={pickerState} onSelect={acceptFileReferenceSuggestion} />
        <textarea
          ref={textareaRef}
          value={prompt}
          rows={1}
          aria-label="Prompt"
          aria-autocomplete="list"
          placeholder="Send a prompt to this Agent Thread…"
          disabled={isDisabled}
          className="block min-h-9 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(event) => handlePromptChange(event, setPrompt)}
          onClick={() => setCursorSequence((sequence) => sequence + 1)}
          onKeyDown={handleKeyDown}
          onSelect={() => setCursorSequence((sequence) => sequence + 1)}
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

function FileReferencePicker({
  state,
  onSelect,
}: {
  state: FileReferencePickerState;
  onSelect: (suggestion: ExplorerFileReferenceSuggestion, token: FileReferenceToken) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const listElement = listRef.current;
    if (listElement === null) {
      return;
    }

    const selectedElement = listElement.querySelector<HTMLElement>('[data-selected="true"]');
    if (selectedElement === null) {
      return;
    }

    selectedElement.scrollIntoView({ block: "nearest" });
  }, [state]);

  if (state.status === "closed") {
    return <></>;
  }

  return (
    <div className="absolute right-0 bottom-full left-0 z-10 mb-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xs">
      {state.status === "loading" && <PickerMessage message="Searching files…" />}
      {state.status === "empty" && <PickerMessage message="No files found" />}
      {state.status === "error" && <PickerMessage message={state.message} />}
      {state.status === "ready" && (
        <div ref={listRef} aria-label="File references" className="max-h-60 overflow-y-auto py-1">
          {state.suggestions.map((suggestion, index) => (
            <button
              key={suggestion.path}
              type="button"
              data-selected={index === state.selectedIndex}
              className="flex w-full min-w-0 items-center gap-3 px-2.5 py-1.5 text-left text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              onClick={() => onSelect(suggestion, state.token)}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{suggestion.label}</span>
              <span className="max-w-1/2 min-w-0 truncate font-mono text-xs text-muted-foreground">
                {suggestion.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PickerMessage({ message }: { message: string }) {
  return <div className="px-2.5 py-2 text-sm text-muted-foreground">{message}</div>;
}

type LoadFileReferenceSuggestionsInput = {
  folderPath: string;
  requestId: number;
  requestSequenceRef: RefObject<number>;
  setPickerState: Dispatch<SetStateAction<FileReferencePickerState>>;
  token: FileReferenceToken;
};

async function loadFileReferenceSuggestions({
  folderPath,
  requestId,
  requestSequenceRef,
  setPickerState,
  token,
}: LoadFileReferenceSuggestionsInput) {
  try {
    const result = await getExplorerFileReferenceSuggestions({
      folderPath,
      query: token.query,
      limit: fileReferenceSuggestionLimit,
    });
    if (requestSequenceRef.current !== requestId) {
      return;
    }

    setPickerState(() => {
      if (result.suggestions.length === 0) {
        return { status: "empty", token };
      }

      return { status: "ready", token, suggestions: result.suggestions, selectedIndex: 0 };
    });
  } catch (error) {
    if (requestSequenceRef.current !== requestId) {
      return;
    }
    setPickerState(() => ({ status: "error", token, message: errorMessageFromUnknown(error) }));
  }
}

function extractFileReferenceToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): FileReferenceToken | undefined {
  if (selectionStart !== selectionEnd) {
    return;
  }

  const beforeCursor = text.slice(0, selectionStart);
  const tokenStart = findFileReferenceTokenStart(beforeCursor);
  if (tokenStart === -1) {
    return;
  }

  const raw = beforeCursor.slice(tokenStart);
  if (raw.startsWith('@"')) {
    return { start: tokenStart, end: selectionStart, query: raw.slice(2), isQuoted: true };
  }

  return { start: tokenStart, end: selectionStart, query: raw.slice(1), isQuoted: false };
}

function findFileReferenceTokenStart(text: string) {
  const quoteStart = text.lastIndexOf('@"');
  if (
    quoteStart >= 0 &&
    isTokenBoundary(text, quoteStart) &&
    !text.slice(quoteStart + 2).includes('"')
  ) {
    return quoteStart;
  }

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === " " || character === "\t" || character === "\n") {
      break;
    }
    if (character === "@" && isTokenBoundary(text, index)) {
      return index;
    }
  }

  return -1;
}

function isTokenBoundary(text: string, index: number) {
  if (index === 0) {
    return true;
  }

  const previous = text[index - 1];
  return previous === " " || previous === "\t" || previous === "\n";
}

function fileReferenceCompletion(
  path: string,
  token: FileReferenceToken,
  kind: ExplorerFileReferenceSuggestion["kind"],
) {
  const needsQuotes = token.isQuoted || path.includes(" ");
  const suffix = kind === "directory" ? "" : " ";
  if (!needsQuotes) {
    return { text: `@${path}${suffix}`, cursorOffset: path.length + 1 + suffix.length };
  }

  const quotedPath = `@"${path}"`;
  const cursorOffset =
    kind === "directory" ? quotedPath.length - 1 : quotedPath.length + suffix.length;
  return { text: `${quotedPath}${suffix}`, cursorOffset };
}

function wrapIndex(index: number, length: number) {
  if (length === 0) {
    return 0;
  }

  return (index + length) % length;
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

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to search files";
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
