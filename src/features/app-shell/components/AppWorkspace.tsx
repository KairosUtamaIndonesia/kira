import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";

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

const workspaceComponents = {
  workspacePanel: WorkspacePanel,
};

function handleWorkspaceReady(event: DockviewReadyEvent) {
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
  return (
    <main className="h-full min-h-0 bg-editor-surface">
      <DockviewReact
        className="dockview-theme-dark kira-dockview"
        components={workspaceComponents}
        defaultHeaderPosition="top"
        dndStrategy="pointer"
        hideBorders
        onReady={handleWorkspaceReady}
      />
    </main>
  );
}

export { AppWorkspace };
