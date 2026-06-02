import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Plus, Terminal as TerminalIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { TerminalPanel, type TerminalPanelParams } from "./TerminalPanel";
import { useTitleBarDrag } from "./useTitleBarDrag";

type WorkspacePanelParams = {
  description: string;
};

function WorkspacePanel({ api, params }: IDockviewPanelProps<WorkspacePanelParams>) {
  return (
    <section className="flex h-full flex-col bg-editor-surface p-4 text-foreground">
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        <div className="space-y-1 text-center">
          <div className="font-medium text-foreground">{api.title}</div>
          <div>{params.description}</div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceHeaderActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  function addTerminalPanel() {
    containerApi.addPanel<TerminalPanelParams>({
      id: `terminal-${crypto.randomUUID()}`,
      component: "terminalPanel",
      title: "Terminal",
      params: {
        terminalId: crypto.randomUUID(),
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

function AppWorkspace() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

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
      <DockviewReact
        className="dockview-theme-dark kira-dockview"
        components={workspaceComponents}
        defaultHeaderPosition="top"
        dndStrategy="pointer"
        hideBorders
        onReady={handleWorkspaceReady}
        rightHeaderActionsComponent={WorkspaceHeaderActions}
      />
      {titleBarError === undefined ? undefined : (
        <output className="sr-only">{titleBarError}</output>
      )}
    </main>
  );
}

export { AppWorkspace };
