import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Plus, Terminal as TerminalIcon } from "lucide-react";
import { createContext, useContext, useMemo, type MouseEvent } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { ActiveWorkspaceState } from "../types";

import { TerminalPanel, type TerminalPanelParams } from "./TerminalPanel";
import { useTitleBarDrag } from "./useTitleBarDrag";

type WorkspacePanelParams = {
  description: string;
};

type WorkspaceRuntimeContextValue = {
  workingDirectory: string;
};

const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeContextValue | undefined>(undefined);

function WorkspacePanel({ api, params }: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <section className="flex h-full flex-col bg-editor-surface p-4 text-foreground">
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
        <div className="space-y-1 text-center">
          <div className="font-medium text-foreground">{api.title}</div>
          <div>{params.description}</div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceHeaderActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const { workingDirectory } = useWorkspaceRuntimeContext();
  function addTerminalPanel() {
    containerApi.addPanel<TerminalPanelParams>({
      id: `terminal-${crypto.randomUUID()}`,
      component: "terminalPanel",
      title: "Terminal",
      params: {
        terminalId: crypto.randomUUID(),
        workingDirectory,
      },
      position: {
        referenceGroup: group,
        direction: "within",
      },
    });
  }

  return (
    <div className="flex h-full items-center px-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Add workspace panel"
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <Plus className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem onClick={addTerminalPanel}>
            <TerminalIcon className="size-4 text-muted-foreground" />
            <span>New Terminal (shell)</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const workspaceComponents = {
  workspacePanel: WorkspacePanel,
  terminalPanel: TerminalPanel,
};

function useWorkspaceRuntimeContext() {
  const context = useContext(WorkspaceRuntimeContext);
  if (context === undefined) {
    throw new Error("Workspace runtime context is required.");
  }

  return context;
}

function isElementInsideSelector(target: EventTarget | null, selector: string) {
  return target instanceof Element && target.closest(selector) !== null;
}

function preventHeaderSpaceDrag(event: DockviewReadyEvent) {
  event.api.onWillDragPanel((dragEvent) => {
    if (!isElementInsideSelector(dragEvent.nativeEvent.target, ".dv-tab")) {
      dragEvent.nativeEvent.preventDefault();
    }
  });

  event.api.onWillDragGroup((dragEvent) => {
    if (isElementInsideSelector(dragEvent.nativeEvent.target, ".dv-void-container")) {
      dragEvent.nativeEvent.preventDefault();
    }
  });
}

function handleWorkspaceReady(event: DockviewReadyEvent) {
  preventHeaderSpaceDrag(event);

  event.api.addPanel({
    id: "welcome",
    component: "workspacePanel",
    title: "Welcome",
    params: {
      description: "Primary workspace panel.",
    },
  });

  event.api.addPanel({
    id: "agent-session",
    component: "workspacePanel",
    title: "Agent Session",
    params: {
      description: "Split, dock, and rearrange panels from here.",
    },
    position: {
      referencePanel: "welcome",
      direction: "right",
    },
  });
}

type AppWorkspaceProps = {
  activeWorkspace: ActiveWorkspaceState;
};

function AppWorkspace({ activeWorkspace }: AppWorkspaceProps) {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const workspaceRuntimeContext = useMemo(
    () => ({
      workingDirectory:
        activeWorkspace.status === "active" ? activeWorkspace.project.folderPath : "",
    }),
    [activeWorkspace],
  );

  return (
    <main
      className="h-full min-h-0 bg-editor-surface"
      onDragStartCapture={(event) => {
        if (isElementInsideSelector(event.target, ".dv-void-container")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDownCapture={(event) => {
        if (isElementInsideSelector(event.target, ".dv-void-container")) {
          event.stopPropagation();
          void handleTitleBarMouseDown(event);
        }
      }}
    >
      {activeWorkspace.status === "active" ? (
        <WorkspaceRuntimeContext.Provider value={workspaceRuntimeContext}>
          <DockviewReact
            key={activeWorkspace.session.id}
            className="dockview-theme-dark kira-dockview"
            components={workspaceComponents}
            defaultHeaderPosition="top"
            dndStrategy="pointer"
            hideBorders
            onReady={handleWorkspaceReady}
            rightHeaderActionsComponent={WorkspaceHeaderActions}
          />
        </WorkspaceRuntimeContext.Provider>
      ) : (
        <WorkspaceEmptyState
          activeWorkspace={activeWorkspace}
          onTitleBarMouseDown={handleTitleBarMouseDown}
        />
      )}
      {titleBarError === undefined ? undefined : (
        <output className="sr-only">{titleBarError}</output>
      )}
    </main>
  );
}

type WorkspaceEmptyStateProps = AppWorkspaceProps & {
  onTitleBarMouseDown: (event: MouseEvent<HTMLElement>) => Promise<void>;
};

function WorkspaceEmptyState({ activeWorkspace, onTitleBarMouseDown }: WorkspaceEmptyStateProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label="Workspace title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground select-none"
        onMouseDown={(event) => {
          void onTitleBarMouseDown(event);
        }}
      />
      {emptyStateContent(activeWorkspace)}
    </div>
  );
}

function emptyStateContent(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground">
        Opening project…
      </div>
    );
  }

  if (activeWorkspace.status === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div role="alert" className="max-w-md rounded-xl border border-border p-4 text-center">
          <div className="font-medium text-foreground">Could not open project</div>
          <div className="mt-1 text-sm text-muted-foreground">{activeWorkspace.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-dashed border-border p-6 text-center">
        <div className="font-medium text-foreground">Select or create a Project</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Choose a Project from the sidebar, or add a local folder to get started.
        </div>
      </div>
    </div>
  );
}

export { AppWorkspace };
