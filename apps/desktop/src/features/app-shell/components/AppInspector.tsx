import { Bot, Files, GitBranch, type LucideIcon } from "lucide-react";
import { useState } from "react";

import type { AgentThreadWorkspacePanel, WorkspacePanel } from "@/features/projects/types";
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
  onAgentThreadOpen: (panelId: string) => void;
  onExplorerFileOpen: (filePath: string) => Promise<void>;
  onSourceControlDiffOpen: (entry: GitStatusEntry) => Promise<void>;
};

type InspectorView = "explorer" | "sourceControl" | "agentThreads";

type InspectorViewAction = {
  view: InspectorView;
  label: string;
  icon: LucideIcon;
};

const inspectorViewActions: InspectorViewAction[] = [
  { view: "explorer", label: "Explorer", icon: Files },
  { view: "sourceControl", label: "Source Control", icon: GitBranch },
  { view: "agentThreads", label: "Agent Threads", icon: Bot },
];

function AppInspector({
  activeWorkspace,
  onAgentThreadOpen,
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
        {inspectorContent(
          activeWorkspace,
          activeView,
          onAgentThreadOpen,
          onExplorerFileOpen,
          onSourceControlDiffOpen,
        )}
      </div>
    </aside>
  );
}

function inspectorContent(
  activeWorkspace: ActiveWorkspaceState,
  activeView: InspectorView,
  onAgentThreadOpen: (panelId: string) => void,
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

  if (activeView === "agentThreads") {
    return (
      <AgentThreadsInspector
        activeWorkspace={activeWorkspace}
        onAgentThreadOpen={onAgentThreadOpen}
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

type AgentThreadsInspectorProps = {
  activeWorkspace: ActiveWorkspaceState;
  onAgentThreadOpen: (panelId: string) => void;
};

function AgentThreadsInspector({ activeWorkspace, onAgentThreadOpen }: AgentThreadsInspectorProps) {
  if (activeWorkspace.status === "loading") {
    return <InspectorNotice>Opening project…</InspectorNotice>;
  }

  if (activeWorkspace.status === "error") {
    return <InspectorNotice role="alert">{activeWorkspace.message}</InspectorNotice>;
  }

  if (activeWorkspace.status !== "active") {
    return <InspectorNotice>Select a Project to view Agent Threads.</InspectorNotice>;
  }

  const agentThreadPanels = activeWorkspace.panels.filter(isAgentThreadPanel);
  if (agentThreadPanels.length === 0) {
    return <InspectorNotice>This Session has no Agent Threads.</InspectorNotice>;
  }

  return (
    <section className="space-y-2 p-3" aria-labelledby="agent-threads-heading">
      <div className="space-y-1">
        <h2 id="agent-threads-heading" className="text-sm font-medium text-foreground">
          Agent Threads
        </h2>
        <p className="text-xs text-muted-foreground">Reopen Agent Thread panels in this Session.</p>
      </div>
      <ol className="space-y-1">
        {agentThreadPanels.map((panel) => (
          <li key={panel.id}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-2 text-left"
              onClick={() => onAgentThreadOpen(panel.id)}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{panel.title}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {panel.agentThreadState.threadId}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InspectorNotice({ children, role }: { children: string; role?: "alert" }) {
  return (
    <div role={role} className="m-3 rounded-xl border border-border p-3 text-muted-foreground">
      {children}
    </div>
  );
}

function isAgentThreadPanel(panel: WorkspacePanel): panel is AgentThreadWorkspacePanel {
  return panel.kind === "agent_thread";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled inspector view: ${value}`);
}

export { AppInspector };
