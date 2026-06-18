import { invoke } from "@tauri-apps/api/core";
import { CornerDownLeft, ListTree, Loader2, Minimize2, Square, X, Zap } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type { ExplorerFileReferenceSuggestion } from "@/features/explorer/types";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getExplorerFileReferenceSuggestions } from "@/features/explorer/api/explorerApi";
import { cn } from "@/lib/utils";

import type { ComposerSlashCommand } from "../commands/slashCommands";
import type {
  AgentThreadContextUsageState,
  AgentThreadRuntimeState,
} from "../hooks/useAgentThreadConnection";

import { clearAgentThreadDraft, useAgentThreadDraft } from "../agentThreadDraftStore";
import { explorerDropPaths, fileReferenceText } from "../explorerDropUtils";
import { useSlashCommands } from "../hooks/useSlashCommands";
import { AgentThreadContextMeter } from "./AgentThreadContextMeter";

type ComposerSlashCommandAction = "compact";

type ComposerProps = {
  threadId: string;
  folderPath: string;
  runtimeState?: AgentThreadRuntimeState;
  contextUsageState?: AgentThreadContextUsageState;
  isCompacting?: boolean;
  isDropTargetActive?: boolean;
  placeholder?: string;
  sendPrompt: (prompt: string) => Promise<boolean>;
  abortPrompt?: () => void;
  runSlashCommandAction?: (
    action: ComposerSlashCommandAction,
    args: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  switchModel?: (modelLabel: string) => Promise<void>;
  isTreeOpen?: boolean;
  onToggleTree?: () => void;
  onCancelEdit?: () => void;
  editingMessageId?: string | undefined;
};

type FileReferenceToken = {
  start: number;
  end: number;
  query: string;
  isQuoted: boolean;
};

type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
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

type SlashCommandPickerState =
  | { status: "closed" }
  | { status: "active"; token: SlashCommandToken; selectedIndex: number };
function Composer({
  threadId,
  folderPath,
  runtimeState,
  contextUsageState,
  isCompacting = false,
  isDropTargetActive = false,
  placeholder = "Send a prompt to this Agent Thread…",
  sendPrompt,
  abortPrompt,
  runSlashCommandAction,
  switchModel,
  editingMessageId,
  onCancelEdit,
  isTreeOpen,
  onToggleTree,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [pickerState, setPickerState] = useState<FileReferencePickerState>({ status: "closed" });
  const [slashPickerState, setSlashPickerState] = useState<SlashCommandPickerState>({
    status: "closed",
  });
  const slashCommands = useSlashCommands({ projectPath: folderPath });
  const [cursorSequence, setCursorSequence] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consumedDraftSequenceRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const dragCounterRef = useRef(0);
  const draft = useAgentThreadDraft(threadId);
  const canSend =
    runtimeState === undefined ||
    runtimeState.status === "ready" ||
    runtimeState.status === "sending";
  const isSending = runtimeState !== undefined && runtimeState.status === "sending";
  const isDisabled = !canSend || isCompacting;

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
      draft.insertion === "inline"
        ? appendFileReferences(current, [draft.text])
        : appendBlockDraft(current, draft.text),
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

    const fileToken = extractFileReferenceToken(
      prompt,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    const slashToken = extractSlashCommandToken(
      prompt,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (fileToken === undefined) {
      setPickerState({ status: "closed" });
    }
    if (slashToken === undefined) {
      setSlashPickerState({ status: "closed" });
    } else {
      setSlashPickerState((current) => ({
        status: "active",
        token: slashToken,
        selectedIndex: current.status === "active" ? current.selectedIndex : 0,
      }));
    }
    if (fileToken === undefined) {
      return;
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setPickerState((current) => ({
      status: "loading",
      token: fileToken,
      selectedIndex:
        current.status === "ready" || current.status === "loading" ? current.selectedIndex : 0,
    }));

    const timeoutId = window.setTimeout(() => {
      void loadFileReferenceSuggestions({
        folderPath,
        requestId,
        requestSequenceRef,
        setPickerState,
        token: fileToken,
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

    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      return;
    }

    // Clear optimistically so the user can compose the next message while
    // the current one streams.
    setPrompt("");
    setPickerState({ status: "closed" });
    setSlashPickerState({ status: "closed" });
    const sent = await sendPrompt(trimmed);
    if (!sent) {
      // Send failed — restore the prompt so the user can retry.
      setPrompt(trimmed);
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

  function acceptSlashCommandSuggestion(command: ComposerSlashCommand, token: SlashCommandToken) {
    setErrorMessage(undefined);
    // Args are the trailing text after the command name, with leading and
    // trailing whitespace removed. Skill bodies are expanded at the agent-pi
    // boundary (mirroring pi's `_expandSkillCommand`); built-in actions like
    // `/compact` forward args to their side effect.
    const args = prompt.slice(token.start + command.invocation.length, token.end).trim();
    const dispatch = command.dispatch(args);
    setSlashPickerState({ status: "closed" });
    if (dispatch.type === "insert") {
      const expansion = `${command.invocation} `;
      const nextPrompt = `${prompt.slice(0, token.start)}${expansion}${prompt.slice(token.end)}`;
      setPrompt(nextPrompt);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea === null) {
          return;
        }
        textarea.focus();
        const cursor = token.start + expansion.length;
        textarea.setSelectionRange(cursor, cursor);
        resizeComposerTextarea(textarea);
      });
      return;
    }
    // Action: clear the token, run the side effect, surface failures inline.
    const cleared = `${prompt.slice(0, token.start)}${prompt.slice(token.end)}`.trimEnd();
    setPrompt(cleared);
    void (async () => {
      try {
        if (runSlashCommandAction === undefined) {
          return;
        }
        const result = await runSlashCommandAction(dispatch.action, args);
        if (!result.ok && result.error !== undefined) {
          setErrorMessage(result.error);
        }
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })();
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(cleared.length, cleared.length);
      resizeComposerTextarea(textarea);
    });
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const explorerPaths = explorerDropPaths(event.dataTransfer);
    if (explorerPaths.length > 0) {
      insertFileReferences(explorerPaths.map(fileReferenceText));
      return;
    }
    handleFileDrop(event.dataTransfer.files);
  }

  function handleFileDrop(files: FileList) {
    insertFileReferences(droppedFileReferences(files, folderPath));
  }

  function insertFileReferences(references: readonly string[]) {
    if (references.length === 0) {
      return;
    }
    setPrompt((current) => appendFileReferences(current, references));
    setPickerState({ status: "closed" });
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }
      textarea.focus();
      resizeComposerTextarea(textarea);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && pickerState.status !== "closed") {
      event.preventDefault();
      setPickerState({ status: "closed" });
      return;
    }
    if (event.key === "Escape" && slashPickerState.status === "active") {
      event.preventDefault();
      setSlashPickerState({ status: "closed" });
      return;
    }

    if (slashPickerState.status === "active") {
      const filtered = filterSlashCommands(slashCommands, slashPickerState.token.query);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length === 0) {
          return;
        }
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSlashPickerState({
          status: "active",
          token: slashPickerState.token,
          selectedIndex: wrapIndex(slashPickerState.selectedIndex + direction, filtered.length),
        });
        return;
      }

      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        const command = filtered[slashPickerState.selectedIndex];
        if (command !== undefined) {
          event.preventDefault();
          void acceptSlashCommandSuggestion(command, slashPickerState.token);
          return;
        }
      }
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
          (isDragging || isDropTargetActive) && "border-dashed border-ring",
          isDisabled && "pointer-events-none opacity-50",
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <FileReferencePicker state={pickerState} onSelect={acceptFileReferenceSuggestion} />
        <SlashCommandPicker
          state={slashPickerState}
          commands={slashCommands}
          onSelect={acceptSlashCommandSuggestion}
        />
        <textarea
          ref={textareaRef}
          value={prompt}
          rows={1}
          aria-label="Prompt"
          aria-autocomplete="list"
          placeholder={placeholder}
          disabled={isDisabled || isSending}
          className="block min-h-9 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(event) => {
            setErrorMessage(undefined);
            handlePromptChange(event, setPrompt);
          }}
          onClick={() => setCursorSequence((sequence) => sequence + 1)}
          onKeyDown={handleKeyDown}
          onSelect={() => setCursorSequence((sequence) => sequence + 1)}
        />
        {isCompacting ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1.5 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground"
          >
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            <span>Compacting…</span>
          </div>
        ) : (
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            {editingMessageId !== undefined && onCancelEdit !== undefined ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Cancel edit"
                onClick={onCancelEdit}
                className="bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden="true" />
              </Button>
            ) : undefined}
            {isSending ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Stop agent response"
                onClick={() => {
                  if (abortPrompt !== undefined) abortPrompt();
                }}
                className="bg-transparent text-destructive hover:bg-muted hover:text-destructive"
              >
                <Square aria-hidden="true" className="size-3" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="ghost"
                size="icon-xs"
                aria-label={sendButtonLabel(runtimeState, isCompacting)}
                disabled={!canSend || isSending || isCompacting || prompt.trim().length === 0}
                className="bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <CornerDownLeft aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between px-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={isTreeOpen ? "Close session tree" : "Open session tree"}
            onClick={onToggleTree}
          >
            <ListTree size={14} />
          </button>
          <span>{composerFootnote(errorMessage, slashPickerState.status === "closed")}</span>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelect switchModel={switchModel} />
          {contextUsageState !== undefined && <AgentThreadContextMeter state={contextUsageState} />}
        </div>
      </div>
    </form>
  );
}

/** Model entry returned by the desktop_org_models_get Tauri command. */
type ModelCatalogItem = {
  label: string;
  upstreamModelId: string;
  providerId: string;
  isDefault: boolean;
};

function ModelSelect({
  switchModel,
}: {
  switchModel: ((label: string) => Promise<void>) | undefined;
}) {
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [currentLabel, setCurrentLabel] = useState<string | undefined>();
  const [selectOpen, setSelectOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog: { models: ModelCatalogItem[] } = await invoke("desktop_org_models_get");
        if (cancelled) return;
        setModels(catalog.models);
        const defaultModel = catalog.models.find((m) => m.isDefault);
        if (defaultModel !== undefined) {
          setCurrentLabel(defaultModel.label);
        }
      } catch {
        // Model catalog fetch failed — leave dropdown empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (models.length === 0) {
    return false;
  }

  const handleValueChange = (value: string | null) => {
    if (value === null) return;
    setCurrentLabel(value);
    if (switchModel !== undefined) {
      void switchModel(value);
    }
  };

  return (
    <Select
      value={currentLabel}
      onValueChange={handleValueChange}
      open={selectOpen}
      onOpenChange={setSelectOpen}
    >
      <Tooltip open={selectOpen ? false : tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger
          render={
            <SelectTrigger
              size="sm"
              className="h-5 max-w-36 truncate rounded-sm border-0 bg-transparent px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg]:text-muted-foreground/30 hover:[&_svg]:text-foreground"
              aria-label="Select model"
            >
              <SelectValue />
            </SelectTrigger>
          }
        />
        <TooltipContent side="top">Model Selector</TooltipContent>
      </Tooltip>
      <SelectContent align="start" className="rounded-md p-1.5">
        {models.map((model) => (
          <SelectItem key={model.label} value={model.label} className="gap-2 py-1.5 pl-2">
            {model.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
              className="flex w-full min-w-0 items-center gap-3 px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
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

function SlashCommandPicker({
  state,
  commands,
  onSelect,
}: {
  state: SlashCommandPickerState;
  commands: readonly ComposerSlashCommand[];
  onSelect: (command: ComposerSlashCommand, token: SlashCommandToken) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "active") {
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

  if (state.status !== "active") {
    return <></>;
  }

  if (commands.length === 0) {
    return (
      <div className="absolute right-0 bottom-full left-0 z-10 mb-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xs">
        <PickerMessage message="No slash commands available" />
      </div>
    );
  }

  const filtered = filterSlashCommands(commands, state.token.query);
  if (filtered.length === 0) {
    return (
      <div className="absolute right-0 bottom-full left-0 z-10 mb-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xs">
        <PickerMessage message="No matching commands" />
      </div>
    );
  }

  return (
    <div className="absolute right-0 bottom-full left-0 z-10 mb-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xs">
      <div ref={listRef} aria-label="Slash commands" className="max-h-60 overflow-y-auto py-1">
        {filtered.map((command, index) => (
          <button
            key={command.name}
            type="button"
            data-selected={index === state.selectedIndex}
            className="flex w-full min-w-0 items-center gap-3 px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            onClick={() => onSelect(command, state.token)}
            onMouseDown={(event) => event.preventDefault()}
          >
            <SlashCommandIcon kind={command.kind} />
            <span className="min-w-0 flex-1 truncate">{command.name}</span>
            <span className="max-w-1/2 min-w-0 truncate text-xs text-muted-foreground">
              {command.description}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t px-2.5 py-1.5 text-xs text-muted-foreground">
        <span>
          {filtered.length} {filtered.length === 1 ? "command" : "commands"}
        </span>
        <span className="font-mono">↑ ↓ ⏎ esc</span>
      </div>
    </div>
  );
}

function SlashCommandIcon({ kind }: { kind: ComposerSlashCommand["kind"] }) {
  if (kind === "skill") {
    return <Zap aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <Minimize2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
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

function filterSlashCommands(
  commands: readonly ComposerSlashCommand[],
  query: string,
): readonly ComposerSlashCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return commands;
  }
  return commands.filter(
    (command) =>
      command.name.toLowerCase().startsWith(trimmed) ||
      command.description.toLowerCase().includes(trimmed),
  );
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

function extractSlashCommandToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): SlashCommandToken | undefined {
  if (selectionStart !== selectionEnd) {
    return;
  }

  const tokenStart = findSlashTokenStart(text, selectionStart);
  if (tokenStart === -1) {
    return;
  }

  const raw = text.slice(tokenStart, selectionStart);
  return {
    start: tokenStart,
    end: selectionStart,
    // The picker filters against the full typed prefix (e.g. `skill:can`),
    // not just the part after a colon. The leading `/` is dropped because
    // the command store uses names like `skill:canon` (no leading slash).
    query: raw.slice(1),
  };
}

function findSlashTokenStart(text: string, cursor: number): number {
  // Walk back from the cursor looking for the `/` that opens the current
  // command token. Whitespace or any character that isn't a slash-safe
  // command char stops the walk. The `/` itself is only accepted when it
  // sits at a word boundary (start of text, or preceded by whitespace).
  for (let index = cursor - 1; index >= 0; index -= 1) {
    const code = text.charCodeAt(index);
    if (code === 47 /* `/` */) {
      return isTokenBoundary(text, index) ? index : -1;
    }
    if (!isSlashCommandCharCode(code)) {
      return -1;
    }
  }
  return -1;
}

function isSlashCommandCharCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 58 || // :
    code === 45 // -
  );
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

function droppedFileReferences(files: FileList, folderPath: string) {
  const references: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files.item(index);
    if (file === null) {
      continue;
    }

    const absolutePath = droppedFilePath(file);
    if (absolutePath === undefined) {
      continue;
    }

    const relativePath = relativeDroppedPath(absolutePath, folderPath);
    if (relativePath === undefined) {
      continue;
    }

    references.push(fileReferenceText(relativePath));
  }

  return references;
}

function droppedFilePath(file: File) {
  const path = (file as File & { path?: unknown }).path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function relativeDroppedPath(absolutePath: string, folderPath: string) {
  const normalizedRoot = trimTrailingSlash(normalizePathSeparators(folderPath));
  const normalizedPath = normalizePathSeparators(absolutePath);
  const rootPrefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(rootPrefix)) {
    return;
  }

  return normalizedPath.slice(rootPrefix.length);
}

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, "/");
}

function trimTrailingSlash(path: string) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function appendFileReferences(prompt: string, references: readonly string[]) {
  const trimmedPrompt = prompt.trimEnd();
  const separator = trimmedPrompt.length > 0 ? " " : "";
  return `${trimmedPrompt}${separator}${references.join("")}`;
}

function appendBlockDraft(prompt: string, text: string) {
  return prompt.trim().length > 0 ? `${prompt}\n\n${text}` : text;
}

function handleDragOver(event: DragEvent<HTMLDivElement>) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
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

function sendButtonLabel(state: AgentThreadRuntimeState | undefined, isCompacting: boolean) {
  if (state === undefined) {
    return "Send";
  }
  if (state.status === "starting" || state.status === "connecting") {
    return "Starting…";
  }
  if (isCompacting) {
    return "Compacting…";
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

function composerFootnote(error: string | undefined, slashPickerClosed: boolean) {
  if (error !== undefined) {
    return (
      <span role="alert" className="text-xs text-destructive">
        {error}
      </span>
    );
  }
  if (slashPickerClosed) {
    return (
      <span className="text-xs text-muted-foreground">
        Type <span className="font-mono text-foreground/80">/</span> to explore commands.
      </span>
    );
  }
  return <></>;
}

export { Composer };
