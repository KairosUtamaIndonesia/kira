import { prepareFileTreeInput } from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { ChevronsUp, File, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { ExplorerPathMetadata } from "../types";

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
  const { state, refresh } = useExplorerTree(folderPath);

  if (folderPath === undefined) {
    return <ExplorerMessage message="Select a Project to view Explorer files." />;
  }

  if (state.status === "idle" || state.status === "loading") {
    return <ExplorerMessage message="Loading Explorer…" />;
  }

  if (state.status === "error") {
    return <ExplorerMessage role="alert" message={state.message} />;
  }

  return (
    <ExplorerTreeView pathMap={state.result.paths} onOpenFile={onOpenFile} onRefresh={refresh} />
  );
}

type ExplorerTreeViewProps = {
  pathMap: Record<string, ExplorerPathMetadata>;
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeView({ pathMap, onOpenFile, onRefresh }: ExplorerTreeViewProps) {
  const sortedPaths = useMemo(() => sortedPathCopy(Object.keys(pathMap)), [pathMap]);
  const preparedInput = useMemo(
    () => prepareFileTreeInput(sortedPaths, { sort: explorerPathSort }),
    [sortedPaths],
  );
  const { model } = useFileTree({
    preparedInput,
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    density: "compact",
  });
  useEffect(() => {
    model.resetPaths(sortedPaths, { preparedInput, initialExpandedPaths: [] });
  }, [model, preparedInput, sortedPaths]);

  const search = useFileTreeSearch(model);
  const selectedPaths = useFileTreeSelection(model);
  const selectedPath = selectedPaths.length === 1 ? selectedPaths[0] : undefined;
  const canOpenSelected = selectedPath !== undefined && sortedPaths.includes(selectedPath);

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
                  onClick={() => model.resetPaths(sortedPaths, { preparedInput, initialExpandedPaths: [] })}
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
        <div className="flex items-center gap-2">
          <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search.value}
            placeholder="Search files"
            className="h-8"
            onFocus={() => search.open(search.value)}
            onChange={(event) => search.setValue(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!canOpenSelected}
          onClick={() => {
            if (selectedPath !== undefined) {
              void onOpenFile(selectedPath);
            }
          }}
        >
          Open selected file
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sortedPaths.length === 0 ? (
          <ExplorerMessage message="This Project folder has no files to show." />
        ) : (
          <FileTree model={model} className="h-full" style={fileTreeThemeStyle as CSSProperties} />
        )}
      </div>
    </div>
  );
}

function sortedPathCopy(paths: string[]) {
  const sortedPaths = [...paths];
  // oxlint-disable-next-line unicorn/no-array-sort -- Sorting a local copy is non-mutating for callers and avoids O(n²) insertion sort on large trees.
  sortedPaths.sort(comparePaths);
  return sortedPaths;
}

function explorerPathSort(
  left: { basename: string; isDirectory: boolean },
  right: { basename: string; isDirectory: boolean },
) {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }

  return comparePaths(left.basename, right.basename);
}

function comparePaths(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
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

export { ExplorerInspector };
