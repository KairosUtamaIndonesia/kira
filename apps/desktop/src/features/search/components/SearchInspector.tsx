import { CaseSensitive, Loader2, Regex, Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { ProjectSearchFileMatch, ProjectSearchMatch, ProjectSearchResult } from "../types";

import { searchProject } from "../api/searchApi";

const searchDebounceMs = 200;

const emptySearchResult = {
  files: [],
  matchCount: 0,
  searchedFileCount: 0,
  skippedFileCount: 0,
  limitReached: undefined,
} satisfies ProjectSearchResult;

type SearchInspectorProps = {
  folderPath: string | undefined;
  onOpenFile: (filePath: string, lineNumber?: number) => Promise<void>;
};

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string; previousResult: ProjectSearchResult }
  | { status: "ready"; query: string; result: ProjectSearchResult }
  | { status: "error"; query: string; message: string; previousResult: ProjectSearchResult };

function SearchInspector({ folderPath, onOpenFile }: SearchInspectorProps) {
  const [query, setQuery] = useState("");
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const requestSequenceRef = useRef(0);
  const trimmedQuery = query.trim();

  useEffect(() => {
    requestSequenceRef.current += 1;
    const requestId = requestSequenceRef.current;

    if (folderPath === undefined || trimmedQuery.length === 0) {
      setState({ status: "idle" });
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setState((currentState) => ({
        status: "loading",
        query: trimmedQuery,
        previousResult: resultFromState(currentState),
      }));

      void runSearchRequest({
        folderPath,
        isCaseSensitive,
        query: trimmedQuery,
        requestId,
        requestSequenceRef,
        setState,
      });
    }, searchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [folderPath, isCaseSensitive, trimmedQuery]);

  if (folderPath === undefined) {
    return <SearchMessage message="Select a Project to search files." />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border px-3 pt-2 pb-3">
        <div className="flex items-center gap-2 text-sm">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">Search Project</span>
          {state.status === "loading" ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : undefined}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              placeholder="Search files with regex"
              className="h-8 pl-8"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Use regular expression"
                  aria-pressed="true"
                  className="bg-accent text-accent-foreground"
                >
                  <Regex aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Regex search is enabled</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Match case"
                  aria-pressed={isCaseSensitive}
                  className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  onClick={() => setIsCaseSensitive((current) => !current)}
                >
                  <CaseSensitive aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Match case</TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-muted-foreground">Regex and multiline search are enabled.</p>
      </div>
      <SearchContent state={state} onOpenFile={onOpenFile} />
    </div>
  );
}

type RunSearchRequestInput = {
  folderPath: string;
  isCaseSensitive: boolean;
  query: string;
  requestId: number;
  requestSequenceRef: RefObject<number>;
  setState: Dispatch<SetStateAction<SearchState>>;
};

async function runSearchRequest({
  folderPath,
  isCaseSensitive,
  query,
  requestId,
  requestSequenceRef,
  setState,
}: RunSearchRequestInput) {
  try {
    const result = await searchProject({ folderPath, query, isCaseSensitive });
    if (requestSequenceRef.current !== requestId) {
      return;
    }

    setState({ status: "ready", query, result });
  } catch (error) {
    if (requestSequenceRef.current !== requestId) {
      return;
    }

    setState((currentState) => ({
      status: "error",
      query,
      message: errorMessageFromUnknown(error),
      previousResult: resultFromState(currentState),
    }));
  }
}

type SearchContentProps = {
  state: SearchState;
  onOpenFile: (filePath: string, lineNumber?: number) => Promise<void>;
};

function SearchContent({ state, onOpenFile }: SearchContentProps) {
  if (state.status === "idle") {
    return <SearchMessage message="Enter a regex to search this Project." />;
  }

  if (state.status === "error") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <div role="alert" className="border-b border-border px-3 py-2 text-xs text-destructive">
          {state.message}
        </div>
        <SearchResults result={state.previousResult} onOpenFile={onOpenFile} />
      </div>
    );
  }

  const result = state.status === "loading" ? state.previousResult : state.result;
  return <SearchResults result={result} onOpenFile={onOpenFile} />;
}

type SearchResultsProps = {
  result: ProjectSearchResult;
  onOpenFile: (filePath: string, lineNumber?: number) => Promise<void>;
};

function SearchResults({ result, onOpenFile }: SearchResultsProps) {
  if (result.matchCount === 0) {
    return <SearchMessage message="No results." />;
  }

  return (
    <div className="min-h-0 flex-1 scrollbar-sleek overflow-auto py-1">
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {result.matchCount} matches in {result.files.length} files. Searched{" "}
        {result.searchedFileCount} files.
        {result.skippedFileCount > 0
          ? ` Skipped ${result.skippedFileCount} binary or large files.`
          : ""}
      </div>
      {result.limitReached === undefined ? undefined : (
        <div className="border-y border-border px-3 py-2 text-xs text-muted-foreground">
          Results stopped at the {limitReasonLabel(result.limitReached)} limit. Refine the search to
          narrow results.
        </div>
      )}
      <ol className="space-y-2 px-2 py-1">
        {result.files.map((fileMatch) => (
          <SearchFileResult key={fileMatch.path} fileMatch={fileMatch} onOpenFile={onOpenFile} />
        ))}
      </ol>
    </div>
  );
}

type SearchFileResultProps = {
  fileMatch: ProjectSearchFileMatch;
  onOpenFile: (filePath: string, lineNumber?: number) => Promise<void>;
};

function SearchFileResult({ fileMatch, onOpenFile }: SearchFileResultProps) {
  return (
    <li className="space-y-1">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => void onOpenFile(fileMatch.path)}
      >
        <span className="min-w-0 flex-1 truncate">{fileMatch.path}</span>
        <span className="shrink-0 text-muted-foreground">{fileMatch.matches.length}</span>
      </button>
      <ol className="space-y-0.5">
        {fileMatch.matches.map((match) => (
          <li key={searchMatchKey(fileMatch.path, match)}>
            <button
              type="button"
              className="grid w-full grid-cols-[3rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => void onOpenFile(fileMatch.path, match.startLineNumber)}
            >
              <span className="text-right font-mono text-muted-foreground">
                {lineNumberLabel(match)}
              </span>
              <SearchMatchPreview match={match} />
            </button>
          </li>
        ))}
      </ol>
    </li>
  );
}

function SearchMatchPreview({ match }: { match: ProjectSearchMatch }) {
  const previewLines = useMemo(() => match.preview.split("\n"), [match.preview]);
  const isSingleLine = match.startLineNumber === match.endLineNumber && previewLines.length === 1;

  if (!isSingleLine || match.ranges.length !== 1) {
    return (
      <span className="min-w-0 font-mono whitespace-pre-wrap text-muted-foreground">
        {match.preview}
      </span>
    );
  }

  const range = match.ranges[0];
  if (range === undefined) {
    return (
      <span className="min-w-0 truncate font-mono text-muted-foreground">{match.preview}</span>
    );
  }

  const before = match.preview.slice(0, range.startColumn - 1);
  const highlighted = match.preview.slice(range.startColumn - 1, range.endColumn - 1);
  const after = match.preview.slice(range.endColumn - 1);

  return (
    <span className="min-w-0 truncate font-mono text-muted-foreground">
      {before}
      <mark className="rounded-sm bg-accent text-accent-foreground">{highlighted}</mark>
      {after}
    </span>
  );
}

function resultFromState(state: SearchState) {
  if (state.status === "ready") {
    return state.result;
  }

  if (state.status === "loading" || state.status === "error") {
    return state.previousResult;
  }

  return emptySearchResult;
}

function lineNumberLabel(match: ProjectSearchMatch) {
  if (match.startLineNumber === match.endLineNumber) {
    return String(match.startLineNumber);
  }

  return `${match.startLineNumber}-${match.endLineNumber}`;
}

function searchMatchKey(filePath: string, match: ProjectSearchMatch) {
  return `${filePath}:${match.startLineNumber}:${match.endLineNumber}:${match.preview}`;
}

function limitReasonLabel(reason: ProjectSearchResult["limitReached"]) {
  if (reason === "matchCount") {
    return "match count";
  }

  if (reason === "matchedFileCount") {
    return "matched file count";
  }

  if (reason === undefined) {
    return "result";
  }

  return assertNever(reason);
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Search failed.";
}

function SearchMessage({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-3 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Search value: ${JSON.stringify(value)}`);
}

export { SearchInspector };
