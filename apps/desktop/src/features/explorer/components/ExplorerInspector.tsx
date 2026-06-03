import { preparePresortedFileTreeInput } from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { File, RefreshCw, Search } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useExplorerTree } from "../hooks/useExplorerTree";

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
    <ExplorerTreeView
      paths={Object.keys(state.result.paths)}
      onOpenFile={onOpenFile}
      onRefresh={refresh}
    />
  );
}

type ExplorerTreeViewProps = {
  paths: string[];
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeView({ paths, onOpenFile, onRefresh }: ExplorerTreeViewProps) {
  const sortedPaths = useMemo(() => sortedPathCopy(paths), [paths]);
  const preparedInput = useMemo(() => preparePresortedFileTreeInput(sortedPaths), [sortedPaths]);
  const { model } = useFileTree({
    preparedInput,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    density: "compact",
  });
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
          <FileTree model={model} className="h-full" />
        )}
      </div>
    </div>
  );
}

function sortedPathCopy(paths: string[]) {
  const sortedPaths: string[] = [];
  for (const path of paths) {
    const insertIndex = sortedPaths.findIndex(
      (candidatePath) => comparePaths(path, candidatePath) < 0,
    );
    if (insertIndex === -1) {
      sortedPaths.push(path);
    } else {
      sortedPaths.splice(insertIndex, 0, path);
    }
  }

  return sortedPaths;
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
