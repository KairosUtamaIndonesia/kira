import { Files, GitBranch, type LucideIcon } from "lucide-react";
import { useState } from "react";

import type { GitStatusEntry } from "@/features/source-control/types";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExplorerInspector } from "@/features/explorer";
import { SourceControlInspector } from "@/features/source-control/components/SourceControlInspector";

import type { ActiveWorkspaceState } from "../types";

import { AppWindowControls } from "./AppWindowControls";
import { useTitleBarDrag } from "./useTitleBarDrag";

type AppInspectorProps = {
  activeWorkspace: ActiveWorkspaceState;
  onExplorerFileOpen: (filePath: string) => Promise<void>;
  onSourceControlDiffOpen: (entry: GitStatusEntry) => Promise<void>;
};

type InspectorView = "explorer" | "sourceControl";

type InspectorViewAction = {
  view: InspectorView;
  label: string;
  icon: LucideIcon;
};

const inspectorViewActions: InspectorViewAction[] = [
  { view: "explorer", label: "Explorer", icon: Files },
  { view: "sourceControl", label: "Source Control", icon: GitBranch },
];

function AppInspector({
  activeWorkspace,
  onExplorerFileOpen,
  onSourceControlDiffOpen,
}: AppInspectorProps) {
  const [activeView, setActiveView] = useState<InspectorView>("explorer");
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div
        role="toolbar"
        aria-label="Inspector title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center justify-end border-b border-sidebar-border bg-sidebar text-sidebar-foreground select-none"
        onDoubleClick={(event) => {
          void handleTitleBarDoubleClick(event);
        }}
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <AppWindowControls />
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
        {inspectorViewActions.map((action) => {
          const Icon = action.icon;
          const isActive = activeView === action.view;

          return (
            <Tooltip key={action.view}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={action.label}
                    aria-pressed={isActive}
                    className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                    onClick={() => setActiveView(action.view)}
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-sleek flex-col gap-3 overflow-auto">
        {inspectorContent(activeWorkspace, activeView, onExplorerFileOpen, onSourceControlDiffOpen)}
      </div>
    </aside>
  );
}

function inspectorContent(
  activeWorkspace: ActiveWorkspaceState,
  activeView: InspectorView,
  onExplorerFileOpen: (filePath: string) => Promise<void>,
  onSourceControlDiffOpen: (entry: GitStatusEntry) => Promise<void>,
) {
  if (activeView === "sourceControl") {
    return (
      <SourceControlInspector
        folderPath={
          activeWorkspace.status === "active" ? activeWorkspace.project.folderPath : undefined
        }
        onOpenDiff={onSourceControlDiffOpen}
      />
    );
  }

  if (activeView === "explorer") {
    return (
      <ExplorerInspector
        folderPath={
          activeWorkspace.status === "active" ? activeWorkspace.project.folderPath : undefined
        }
        onOpenFile={onExplorerFileOpen}
      />
    );
  }

  if (activeView !== "explorer") {
    return assertNever(activeView);
  }

  if (activeWorkspace.status === "loading") {
    return (
      <div className="rounded-xl border border-border p-3 text-muted-foreground">
        Opening project…
      </div>
    );
  }

  if (activeWorkspace.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-border p-3 text-muted-foreground">
        {activeWorkspace.message}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-3 text-muted-foreground">
      Select a Project to view its details.
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled inspector view: ${value}`);
}

export { AppInspector };
