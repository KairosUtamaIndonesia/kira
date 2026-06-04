import { preparePresortedFileTreeInput } from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { ChevronsUp, File, RefreshCw, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const { state, refresh } = useExplorerTree(folderPath);

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
          onOpenFile={onOpenFile}
          onRefresh={refresh}
        />
      );
    }

    return <ExplorerMessage role="alert" message={state.message} />;
  }

  return (
    <ExplorerTreeView entries={state.result.entries} onOpenFile={onOpenFile} onRefresh={refresh} />
  );
}

type ExplorerTreeViewProps = {
  entries: ExplorerEntry[];
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeView({ entries, onOpenFile, onRefresh }: ExplorerTreeViewProps) {
  const [collapseSequence, setCollapseSequence] = useState(0);
  const treePaths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const filePaths = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [entries],
  );

  return (
    <ExplorerTreeModel
      key={collapseSequence}
      treePaths={treePaths}
      filePaths={filePaths}
      onCollapseAll={() => setCollapseSequence((currentSequence) => currentSequence + 1)}
      onOpenFile={onOpenFile}
      onRefresh={onRefresh}
    />
  );
}

type ExplorerTreeModelProps = {
  treePaths: string[];
  filePaths: ReadonlySet<string>;
  onCollapseAll: () => void;
  onOpenFile: (filePath: string) => Promise<void>;
  onRefresh: () => void;
};

function ExplorerTreeModel({
  treePaths,
  filePaths,
  onCollapseAll,
  onOpenFile,
  onRefresh,
}: ExplorerTreeModelProps) {
  const preparedInput = useMemo(() => preparePresortedFileTreeInput(treePaths), [treePaths]);
  const { model } = useFileTree({
    preparedInput,
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    density: "compact",
  });
  const search = useFileTreeSearch(model);
  const selectedPaths = useFileTreeSelection(model);
  const selectedPath = selectedPaths.length === 1 ? selectedPaths[0] : undefined;
  const canOpenSelected = selectedPath !== undefined && filePaths.has(selectedPath);

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
            if (selectedPath !== undefined && filePaths.has(selectedPath)) {
              void onOpenFile(selectedPath);
            }
          }}
        >
          Open selected file
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {treePaths.length === 0 ? (
          <ExplorerMessage message="This Project folder has no files to show." />
        ) : (
          <FileTree model={model} className="h-full" style={fileTreeThemeStyle as CSSProperties} />
        )}
      </div>
    </div>
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

export { ExplorerInspector };
