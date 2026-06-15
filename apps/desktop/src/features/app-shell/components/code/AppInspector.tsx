import { Bot, Boxes, Files, GitBranch, Search, type LucideIcon } from "lucide-react";
import { useState } from "react";

import type { InstalledSkill } from "@/features/skills";
import type { GitStatusEntry } from "@/features/source-control/types";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExplorerInspector } from "@/features/explorer";
import { sessionRootPath } from "@/features/projects/sessionRoot";
import { SearchInspector } from "@/features/search";
import { SkillsInspector } from "@/features/skills";
import { SourceControlInspector } from "@/features/source-control/components/SourceControlInspector";

import type { ActiveWorkspaceState } from "../../types";

import { AppWindowControls } from "../shared/AppWindowControls";
import { useTitleBarDrag } from "../shared/useTitleBarDrag";
import { AgentThreadsInspector } from "./AgentThreadsInspector";

type AppInspectorProps = {
  activeWorkspace: ActiveWorkspaceState;
  onAgentThreadClose: (panelId: string) => void;
  onAgentThreadDelete: (panelId: string) => Promise<void>;
  onAgentThreadOpen: (panelId: string) => void;
  onAgentThreadRename: (panelId: string, title: string) => Promise<void>;
  onExplorerFileOpen: (filePath: string, lineNumber?: number) => Promise<void>;
  onSkillOpen: (skill: InstalledSkill) => Promise<void>;
  onSourceControlDiffOpen: (entry: GitStatusEntry) => Promise<void>;
};

type InspectorView = "explorer" | "search" | "sourceControl" | "skills" | "agentThreads";

type InspectorViewAction = {
  view: InspectorView;
  label: string;
  icon: LucideIcon;
};

const inspectorViewActions: InspectorViewAction[] = [
  { view: "explorer", label: "Explorer", icon: Files },
  { view: "search", label: "Search", icon: Search },
  { view: "sourceControl", label: "Source Control", icon: GitBranch },
  { view: "skills", label: "Skills", icon: Boxes },
  { view: "agentThreads", label: "Agent Threads", icon: Bot },
];

function AppInspector({
  activeWorkspace,
  onAgentThreadClose,
  onAgentThreadDelete,
  onAgentThreadOpen,
  onAgentThreadRename,
  onExplorerFileOpen,
  onSkillOpen,
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
        {inspectorContent({
          activeView,
          activeWorkspace,
          onAgentThreadClose,
          onAgentThreadDelete,
          onAgentThreadOpen,
          onAgentThreadRename,
          onExplorerFileOpen,
          onSkillOpen,
          onSourceControlDiffOpen,
        })}
      </div>
    </aside>
  );
}

type InspectorContentProps = Pick<
  AppInspectorProps,
  | "activeWorkspace"
  | "onAgentThreadClose"
  | "onAgentThreadDelete"
  | "onAgentThreadOpen"
  | "onAgentThreadRename"
  | "onExplorerFileOpen"
  | "onSkillOpen"
  | "onSourceControlDiffOpen"
> & {
  activeView: InspectorView;
};

function inspectorContent({
  activeView,
  activeWorkspace,
  onAgentThreadClose,
  onAgentThreadDelete,
  onAgentThreadOpen,
  onAgentThreadRename,
  onExplorerFileOpen,
  onSkillOpen,
  onSourceControlDiffOpen,
}: InspectorContentProps) {
  const activeFolderPath =
    activeWorkspace.status === "active"
      ? sessionRootPath(activeWorkspace.project, activeWorkspace.session)
      : undefined;

  if (activeView === "search") {
    return <SearchInspector folderPath={activeFolderPath} onOpenFile={onExplorerFileOpen} />;
  }

  if (activeView === "sourceControl") {
    return (
      <SourceControlInspector folderPath={activeFolderPath} onOpenDiff={onSourceControlDiffOpen} />
    );
  }

  if (activeView === "skills") {
    return (
      <SkillsInspector
        folderPath={activeFolderPath}
        onOpenSkill={(skill) => void onSkillOpen(skill)}
      />
    );
  }

  if (activeView === "agentThreads") {
    return (
      <AgentThreadsInspector
        activeWorkspace={activeWorkspace}
        onAgentThreadClose={onAgentThreadClose}
        onAgentThreadDelete={onAgentThreadDelete}
        onAgentThreadOpen={onAgentThreadOpen}
        onAgentThreadRename={onAgentThreadRename}
      />
    );
  }

  if (activeView === "explorer") {
    return <ExplorerInspector folderPath={activeFolderPath} onOpenFile={onExplorerFileOpen} />;
  }

  return assertNever(activeView);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled inspector view: ${value}`);
}

export { AppInspector };
