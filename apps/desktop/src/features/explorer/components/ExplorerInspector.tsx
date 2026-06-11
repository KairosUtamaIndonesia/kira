import { prepareFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { ChevronsUp, File, RefreshCw, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { explorerDragDataKey } from "@/features/explorer";

import type { ExplorerDirectoryError } from "../store/explorerStore";
import type { ExplorerEntry } from "../types";

import { useExplorerTree } from "../hooks/useExplorerTree";

type FileTreeThemeStyle = CSSProperties & Record<`--${string}`, string>;

const fileTreeThemeStyle = {
  "--trees-bg-override": "var(--card)",
  "--trees-fg-override": "var(--card-foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-bg-muted-override": "var(--muted)",
  "--trees-input-bg-override": "var(--input)",
  "--trees-search-bg-override": "var(--input)",
  "--trees-search-fg-override": "var(--foreground)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  "--trees-border-color-override": "var(--border)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-indent-guide-bg-override": "var(--border)",
  "--trees-scrollbar-thumb-override": "var(--border)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "0.8125rem",
  "--trees-border-radius-override": "var(--radius-md)",
} satisfies FileTreeThemeStyle;

type ExplorerInspectorProps = {
  folderPath: string | undefined;
  onOpenFile: (filePath: string) => Promise<void>;
};

function ExplorerInspector({ folderPath, onOpenFile }: ExplorerInspectorProps) {
  const { state, loadDirectory, refresh } = useExplorerTree(folderPath);

  if (folderPath === undefined) {
    return <ExplorerMessage message="Select a Project to view Explorer files." />;
  }

  if (state.status === "idle") {
    return <ExplorerMessage message="Loading Explorer…" />;
  }

  if (state.status === "loading") {
    if (state.previousResult !== undefined) {
      return (
        <ExplorerTreeView
          entries={state.previousResult.entries}
          onLoadDirectory={loadDirectory}
          onOpenFile={onOpenFile}
          onRefresh={refresh}
        />
      );
    }

    return <ExplorerMessage message="Loading Explorer…" />;
  }

  if (state.status === "error") {
    if (state.previousResult !== undefined) {
      return (
        <ExplorerTreeView
          entries={state.previousResult.entries}
          onLoadDirectory={loadDirectory}
          onOpenFile={onOpenFile}
          onRefresh={refresh}
        />
      );
    }

    return <ExplorerMessage role="alert" message={state.message} />;
  }

  return (
    <ExplorerTreeView
      directoryError={state.directoryError}
      entries={state.result.entries}
      onLoadDirectory={loadDirectory}
      onOpenFile={onOpenFile}
      onRefresh={refresh}
    />
  );
}

type ExplorerTreeViewProps = {
  directoryError?: ExplorerDirectoryError | undefined;
  entries: ExplorerEntry[];
  onLoadDirectory: (directoryPath: string) => void;
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeView({
  directoryError,
  entries,
  onLoadDirectory,
  onOpenFile,
  onRefresh,
}: ExplorerTreeViewProps) {
  const [collapseSequence, setCollapseSequence] = useState(0);
  const treePaths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const filePaths = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [entries],
  );
  const directoryPaths = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path)),
    [entries],
  );

  return (
    <ExplorerTreeModel
      key={collapseSequence}
      directoryError={directoryError}
      directoryPaths={directoryPaths}
      filePaths={filePaths}
      treePaths={treePaths}
      onCollapseAll={() => setCollapseSequence((currentSequence) => currentSequence + 1)}
      onLoadDirectory={onLoadDirectory}
      onOpenFile={onOpenFile}
      onRefresh={onRefresh}
    />
  );
}

type ExplorerTreeModelProps = {
  directoryError?: ExplorerDirectoryError | undefined;
  directoryPaths: ReadonlySet<string>;
  treePaths: string[];
  filePaths: ReadonlySet<string>;
  onCollapseAll: () => void;
  onLoadDirectory: (directoryPath: string) => void;
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeModel({
  directoryError,
  directoryPaths,
  treePaths,
  filePaths,
  onCollapseAll,
  onLoadDirectory,
  onOpenFile,
  onRefresh,
}: ExplorerTreeModelProps) {
  const expandedPathsRef = useRef<readonly string[]>([]);
  const didInitializePathsRef = useRef(false);
  const draggedFilePathsRef = useRef<readonly string[]>([]);
  // Tracks the last file path selected by a pointer/keyboard interaction so the
  // click handler can open it. Stored in a ref (not state) so it is synchronously
  // current when handleTreeClick fires after pointerup/click.
  const pendingOpenFileRef = useRef<string | undefined>();
  const runtimeRef = useRef({ directoryPaths, filePaths, onLoadDirectory, onOpenFile });
  runtimeRef.current = { directoryPaths, filePaths, onLoadDirectory, onOpenFile };
  const preparedInput = useMemo(() => prepareFileTreeInput(treePaths), [treePaths]);
  const handleSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    if (selectedPaths.length !== 1) {
      pendingOpenFileRef.current = undefined;
      return;
    }

    const selectedPath = selectedPaths[0];
    if (selectedPath === undefined) {
      pendingOpenFileRef.current = undefined;
      return;
    }

    const runtime = runtimeRef.current;
    if (runtime.filePaths.has(selectedPath)) {
      // Do NOT open the file here — this fires on pointerdown, which is also
      // the start of a drag gesture. Opening here would open a file editor
      // panel on every drag attempt. Instead, record the path and open it
      // in handleTreeClick, which only fires for click (never for drags).
      pendingOpenFileRef.current = selectedPath;
      return;
    }

    pendingOpenFileRef.current = undefined;
    if (runtime.directoryPaths.has(selectedPath)) {
      expandedPathsRef.current = includeExpandedPath(expandedPathsRef.current, selectedPath);
      runtime.onLoadDirectory(selectedPath);
    }
  }, []);
  const { model } = useFileTree({
    preparedInput,
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    fileTreeSearchMode: "hide-non-matches",
    density: "compact",
    onSelectionChange: handleSelectionChange,
    dragAndDrop: {
      canDrag(paths) {
        const isFilePaths = paths.every((p) => runtimeRef.current.filePaths.has(p));
        // Capture the dragged paths synchronously here — this fires inside the
        // shadow-DOM phase of dragstart, before our light-DOM handleDragStart runs,
        // so it is always current regardless of React's render scheduling.
        draggedFilePathsRef.current = isFilePaths ? paths : [];
        return isFilePaths;
      },
      canDrop() {
        return true;
      },
      onDropComplete() {
        // Intra-tree drops are intentionally no-ops. File insertion is handled
        // at the panel level via dragstart + setAgentThreadDraft.
      },
    },
  });
  const search = useFileTreeSearch(model);
  const syncExpandedDirectories = useCallback(() => {
    const runtime = runtimeRef.current;
    const expandedPaths = expandedDirectoryPathsFromModel(model, runtime.directoryPaths);
    expandedPathsRef.current = expandedPaths;

    for (const expandedPath of expandedPaths) {
      runtime.onLoadDirectory(expandedPath);
    }
  }, [model]);

  useEffect(() => {
    syncExpandedDirectories();
    return model.subscribe(syncExpandedDirectories);
  }, [model, syncExpandedDirectories]);

  useEffect(() => {
    if (!didInitializePathsRef.current) {
      didInitializePathsRef.current = true;
      return;
    }

    model.resetPaths(treePaths, {
      preparedInput,
      initialExpandedPaths: currentExpandedPathsForTree(expandedPathsRef.current, directoryPaths),
    });
  }, [directoryPaths, model, preparedInput, treePaths]);

  const treeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = treeContainerRef.current;
    if (container === null) {
      return;
    }
    function onDragStart(event: Event) {
      const drag = event as DragEvent;
      const filesToDrag = draggedFilePathsRef.current;
      if (filesToDrag.length === 0 || drag.dataTransfer === null) {
        return;
      }
      drag.dataTransfer.effectAllowed = "copy";
      drag.dataTransfer.setData(explorerDragDataKey, JSON.stringify([...filesToDrag]));
    }
    container.addEventListener("dragstart", onDragStart);
    return () => {
      container.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  function handleTreeClick() {
    const path = pendingOpenFileRef.current;
    if (path === undefined) {
      return;
    }
    void runtimeRef.current.onOpenFile(path);
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      handleTreeClick();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border px-3 pt-2 pb-3">
        <div className="flex items-center gap-2 text-sm">
          <File className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">Explorer</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse all Explorer folders"
                  onClick={onCollapseAll}
                >
                  <ChevronsUp aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Collapse all</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh Explorer"
                  onClick={onRefresh}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search.value}
            placeholder="Search loaded files"
            className="h-8 pl-8"
            onChange={(event) => search.setValue(event.target.value)}
          />
        </div>
        {directoryError !== undefined ? (
          <ExplorerDirectoryErrorMessage error={directoryError} />
        ) : (
          false
        )}
      </div>
      <div
        ref={treeContainerRef}
        className="min-h-0 flex-1 overflow-hidden"
        role="none"
        onClick={handleTreeClick}
        onKeyDown={handleTreeKeyDown}
        onDragOver={handleExplorerTreeDragOver}
      >
        {treePaths.length === 0 ? (
          <ExplorerMessage message="This Project folder has no files to show." />
        ) : (
          <FileTree model={model} className="h-full" style={fileTreeThemeStyle as CSSProperties} />
        )}
      </div>
    </div>
  );
}

function expandedDirectoryPathsFromModel(
  model: ReturnType<typeof useFileTree>["model"],
  directoryPaths: ReadonlySet<string>,
) {
  const expandedPaths: string[] = [];
  for (const directoryPath of directoryPaths) {
    const item = model.getItem(directoryPath);
    if (item !== null && "isExpanded" in item && item.isExpanded()) {
      expandedPaths.push(directoryPath);
    }
  }

  return expandedPaths;
}

function includeExpandedPath(expandedPaths: readonly string[], selectedPath: string) {
  if (expandedPaths.includes(selectedPath)) {
    return expandedPaths;
  }

  return [...expandedPaths, selectedPath];
}

function currentExpandedPathsForTree(
  expandedPaths: readonly string[],
  directoryPaths: ReadonlySet<string>,
) {
  return expandedPaths.filter((expandedPath) => directoryPaths.has(expandedPath));
}

function ExplorerDirectoryErrorMessage({ error }: { error: ExplorerDirectoryError }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      Failed to load {error.directoryPath}: {error.message}
    </p>
  );
}

function ExplorerMessage({ message, role }: { message: string; role?: "alert" }) {
  return (
    <div
      role={role}
      className="flex min-h-0 flex-1 items-center justify-center p-3 text-sm text-muted-foreground"
    >
      {message}
    </div>
  );
}

function handleExplorerTreeDragOver(event: DragEvent<HTMLDivElement>) {
  if (!event.dataTransfer.types.includes(explorerDragDataKey)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export { ExplorerInspector };
