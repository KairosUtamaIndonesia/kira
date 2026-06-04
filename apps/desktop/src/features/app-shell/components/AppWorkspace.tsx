import { invoke } from "@tauri-apps/api/core";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Bot, Loader2, Plus, Terminal as TerminalIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

import type { WorkspacePanel as StoredWorkspacePanel } from "@/features/projects/types";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentThreadPanel, type AgentThreadPanelParams } from "@/features/agent-thread";
import { FileEditorPanel, type FileEditorPanelParams } from "@/features/editor";
import {
  createTerminalPanel,
  deleteTerminalSnapshot,
  deleteWorkspacePanel,
  updateSessionLayout,
} from "@/features/projects/api/projectsApi";
import {
  SourceControlDiffPanel,
  type SourceControlDiffPanelParams,
} from "@/features/source-control/components/SourceControlDiffPanel";

import type {
  ActiveWorkspaceState,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
} from "../types";

import { TerminalPanel, type TerminalPanelParams } from "./TerminalPanel";
import { useTitleBarDrag } from "./useTitleBarDrag";

type WorkspacePanelParams = {
  description: string;
};

type WorkspaceRuntimeContextValue = {
  projectId: string;
  sessionId: string;
  workingDirectory: string;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
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
  const { onPanelCreated, projectId, sessionId, workingDirectory } = useWorkspaceRuntimeContext();

  async function addTerminalPanel() {
    const panel = await createTerminalPanel({
      sessionId,
      title: "Terminal",
      workingDirectory,
    });
    const terminalState = requireTerminalState(panel);
    onPanelCreated(panel);
    containerApi.addPanel<TerminalPanelParams>({
      id: panel.id,
      component: "terminalPanel",
      title: panel.title,
      params: {
        terminalId: panel.id,
        workingDirectory: terminalState.workingDirectory,
      },
      position: {
        referenceGroup: group,
        direction: "within",
      },
    });
    await updateSessionLayout({
      sessionId,
      layoutJson: serializeWorkspaceLayoutForPersistence(containerApi.toJSON()),
    });
  }

  function addAgentThreadPanel() {
    const threadId = crypto.randomUUID();
    containerApi.addPanel<AgentThreadPanelParams>({
      id: threadId,
      component: "agentThreadPanel",
      title: "Agent Thread",
      params: {
        projectId,
        sessionId,
        threadId,
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
          <DropdownMenuItem onClick={() => addAgentThreadPanel()}>
            <Bot className="size-4 text-muted-foreground" />
            <span>New Agent Thread</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void addTerminalPanel()}>
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
  sourceControlDiffPanel: SourceControlDiffPanel,
  fileEditorPanel: FileEditorPanel,
  agentThreadPanel: AgentThreadPanel,
};

const runtimeOnlyWorkspaceComponents = new Set(["agentThreadPanel"]);

function requireTerminalState(panel: StoredWorkspacePanel) {
  if (panel.kind !== "terminal") {
    throw new Error(`Workspace panel ${panel.id} is not a terminal panel.`);
  }

  return panel.terminalState;
}

function requireSourceControlDiffState(panel: StoredWorkspacePanel) {
  if (panel.kind !== "source_control_diff") {
    throw new Error(`Workspace panel ${panel.id} is not a source control diff panel.`);
  }

  return panel.sourceControlDiffState;
}

function requireFileEditorState(panel: StoredWorkspacePanel) {
  if (panel.kind !== "file_editor") {
    throw new Error(`Workspace panel ${panel.id} is not a file editor panel.`);
  }

  return panel.fileEditorState;
}

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

function restoreWorkspacePanels(
  event: DockviewReadyEvent,
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  panelsRef: RefObject<StoredWorkspacePanel[]>,
  onPanelDeleted: (panelId: string) => void,
  isWorkspaceDisposingRef: RefObject<boolean>,
) {
  preventHeaderSpaceDrag(event);

  if (activeWorkspace.session.layoutJson !== null) {
    try {
      const serializedLayout = JSON.parse(activeWorkspace.session.layoutJson) as Parameters<
        typeof event.api.fromJSON
      >[0];
      ensureSavedLayoutReferencesStoredPanels(serializedLayout, activeWorkspace.panels);
      event.api.fromJSON(serializedLayout);
      const restoredMissingPanels = restoreMissingStoredPanels(event, activeWorkspace.panels);
      if (restoredMissingPanels) {
        void saveWorkspaceLayoutIfActive(
          activeWorkspace.session.id,
          event,
          isWorkspaceDisposingRef,
        );
      }
    } catch {
      restorePanelsWithoutLayout(event, activeWorkspace.panels);
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
    }
  } else {
    restorePanelsWithoutLayout(event, activeWorkspace.panels);
    void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
  }

  event.api.onDidRemovePanel((panel) => {
    if (isWorkspaceDisposingRef.current) {
      return;
    }

    const storedPanel = panelsRef.current.find((workspacePanel) => workspacePanel.id === panel.id);
    if (storedPanel === undefined) {
      return;
    }

    if (storedPanel.kind === "terminal") {
      void killTerminalSession(panel.id);
      void deleteTerminalSnapshot({ terminalId: panel.id });
    }

    onPanelDeleted(panel.id);
    void deleteWorkspacePanel({ panelId: panel.id });
    void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
  });
  event.api.onDidMovePanel(
    () =>
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef),
  );
  event.api.onDidActivePanelChange(
    () =>
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef),
  );
  event.api.onDidAddPanel(
    () =>
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef),
  );
}

function ensureSavedLayoutReferencesStoredPanels(layout: unknown, panels: StoredWorkspacePanel[]) {
  const storedPanelIds = new Set(panels.map((panel) => panel.id));
  for (const layoutPanelId of savedLayoutPanelIds(layout)) {
    if (!storedPanelIds.has(layoutPanelId)) {
      throw new Error(`Saved Workspace layout references missing panel ${layoutPanelId}.`);
    }
  }
}

function savedLayoutPanelIds(layout: unknown) {
  const layoutRecord = requireObjectRecord(layout, "Saved Workspace layout");
  if (!("panels" in layoutRecord)) {
    throw new Error("Saved Workspace layout is missing panels.");
  }

  return Object.keys(requireObjectRecord(layoutRecord.panels, "Saved Workspace layout panels"));
}

function requireObjectRecord(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function restoreMissingStoredPanels(event: DockviewReadyEvent, panels: StoredWorkspacePanel[]) {
  let restoredAnyPanel = false;

  for (const panel of panels) {
    if (event.api.getPanel(panel.id) !== undefined) {
      continue;
    }

    restoreWorkspacePanel(event, panel);
    restoredAnyPanel = true;
  }

  return restoredAnyPanel;
}

function restorePanelsWithoutLayout(event: DockviewReadyEvent, panels: StoredWorkspacePanel[]) {
  for (const panel of panels) {
    restoreWorkspacePanel(event, panel);
  }
}

function restoreWorkspacePanel(event: DockviewReadyEvent, panel: StoredWorkspacePanel) {
  switch (panel.kind) {
    case "terminal": {
      const terminalState = requireTerminalState(panel);
      event.api.addPanel<TerminalPanelParams>({
        id: panel.id,
        component: "terminalPanel",
        title: panel.title,
        params: {
          terminalId: panel.id,
          workingDirectory: terminalState.workingDirectory,
        },
      });
      return;
    }
    case "source_control_diff": {
      const sourceControlDiffState = requireSourceControlDiffState(panel);
      event.api.addPanel<SourceControlDiffPanelParams>({
        id: panel.id,
        component: "sourceControlDiffPanel",
        title: panel.title,
        params: sourceControlDiffState,
      });
      return;
    }
    case "file_editor": {
      const fileEditorState = requireFileEditorState(panel);
      event.api.addPanel<FileEditorPanelParams>({
        id: panel.id,
        component: "fileEditorPanel",
        title: panel.title,
        params: fileEditorState,
      });
      return;
    }
  }
}

async function killTerminalSession(sessionId: string) {
  try {
    await invoke("terminal_kill", { id: sessionId });
  } catch {
    // Terminal sessions are runtime-owned and may already be gone when a persisted panel is closed.
  }
}

async function saveWorkspaceLayoutIfActive(
  sessionId: string,
  event: DockviewReadyEvent,
  isWorkspaceDisposingRef: RefObject<boolean>,
) {
  if (isWorkspaceDisposingRef.current) {
    return;
  }

  await updateSessionLayout({
    sessionId,
    layoutJson: serializeWorkspaceLayoutForPersistence(event.api.toJSON()),
  });
}

type ActiveWorkspaceDockviewProps = {
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>;
  isWorkspaceDisposingRef: RefObject<boolean>;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  sourceControlDiffRequest: SourceControlDiffOpenRequest | undefined;
  fileEditorRequest: FileEditorOpenRequest | undefined;
  onPanelDeleted: (panelId: string) => void;
};

function ActiveWorkspaceDockview({
  activeWorkspace,
  isWorkspaceDisposingRef,
  onPanelCreated,
  sourceControlDiffRequest,
  fileEditorRequest,
  onPanelDeleted,
}: ActiveWorkspaceDockviewProps) {
  const [dockviewApi, setDockviewApi] = useState<DockviewReadyEvent["api"]>();
  const panelsRef = useRef(activeWorkspace.panels);
  panelsRef.current = activeWorkspace.panels;
  const workspaceRuntimeContext = useMemo(
    () => ({
      projectId: activeWorkspace.project.id,
      sessionId: activeWorkspace.session.id,
      workingDirectory: activeWorkspace.project.folderPath,
      onPanelCreated,
    }),
    [activeWorkspace, onPanelCreated],
  );

  useEffect(() => {
    if (dockviewApi === undefined || sourceControlDiffRequest === undefined) {
      return;
    }

    const panel = activeWorkspace.panels.find(
      (workspacePanel) => workspacePanel.id === sourceControlDiffRequest.panel.id,
    );
    if (panel === undefined || panel.kind !== "source_control_diff") {
      return;
    }

    const existingPanel = dockviewApi.getPanel(panel.id);
    if (existingPanel !== undefined) {
      existingPanel.api.setActive();
      return;
    }

    dockviewApi.addPanel<SourceControlDiffPanelParams>({
      id: panel.id,
      component: "sourceControlDiffPanel",
      title: panel.title,
      params: panel.sourceControlDiffState,
    });
  }, [activeWorkspace.panels, dockviewApi, sourceControlDiffRequest]);

  useEffect(() => {
    if (dockviewApi === undefined || fileEditorRequest === undefined) {
      return;
    }

    const panel = activeWorkspace.panels.find(
      (workspacePanel) => workspacePanel.id === fileEditorRequest.panel.id,
    );
    if (panel === undefined || panel.kind !== "file_editor") {
      return;
    }

    const existingPanel = dockviewApi.getPanel(panel.id);
    if (existingPanel !== undefined) {
      existingPanel.api.setActive();
      return;
    }

    dockviewApi.addPanel<FileEditorPanelParams>({
      id: panel.id,
      component: "fileEditorPanel",
      title: panel.title,
      params: panel.fileEditorState,
    });
  }, [activeWorkspace.panels, dockviewApi, fileEditorRequest]);

  return (
    <div className="h-full min-h-0">
      <WorkspaceRuntimeContext.Provider value={workspaceRuntimeContext}>
        <DockviewReact
          key={activeWorkspace.session.id}
          className="dockview-theme-dark kira-dockview"
          components={workspaceComponents}
          defaultHeaderPosition="top"
          dndStrategy="pointer"
          hideBorders
          onReady={(event) => {
            setDockviewApi(event.api);
            restoreWorkspacePanels(
              event,
              activeWorkspace,
              panelsRef,
              onPanelDeleted,
              isWorkspaceDisposingRef,
            );
          }}
          leftHeaderActionsComponent={WorkspaceHeaderActions}
        />
      </WorkspaceRuntimeContext.Provider>
    </div>
  );
}

function serializeWorkspaceLayoutForPersistence(value: unknown) {
  return JSON.stringify(removeRuntimeOnlyWorkspacePanels(value));
}

function removeRuntimeOnlyWorkspacePanels(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => removeRuntimeOnlyWorkspacePanels(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const nextRecord: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isRuntimeOnlyWorkspacePanel(item)) {
      continue;
    }

    nextRecord[key] = removeRuntimeOnlyWorkspacePanels(item);
  }

  return nextRecord;
}

function isRuntimeOnlyWorkspacePanel(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  const component = value.component;
  return typeof component === "string" && runtimeOnlyWorkspaceComponents.has(component);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AppWorkspaceProps = {
  activeWorkspace: ActiveWorkspaceState;
  sourceControlDiffRequest: SourceControlDiffOpenRequest | undefined;
  fileEditorRequest: FileEditorOpenRequest | undefined;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  onPanelDeleted: (panelId: string) => void;
};

function AppWorkspace({
  activeWorkspace,
  sourceControlDiffRequest,
  fileEditorRequest,
  onPanelCreated,
  onPanelDeleted,
}: AppWorkspaceProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const isWorkspaceDisposingRef = useRef(false);
  isWorkspaceDisposingRef.current = activeWorkspace.status !== "active";

  return (
    <main
      className="relative h-full min-h-0 bg-editor-surface"
      onPointerDownCapture={(event) => {
        if (isElementInsideSelector(event.target, ".dv-void-container")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDragStartCapture={(event) => {
        if (isElementInsideSelector(event.target, ".dv-void-container")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {activeWorkspace.status === "active" && activeWorkspace.panels.length > 0 ? (
        <ActiveWorkspaceDockview
          activeWorkspace={activeWorkspace}
          isWorkspaceDisposingRef={isWorkspaceDisposingRef}
          onPanelCreated={onPanelCreated}
          sourceControlDiffRequest={sourceControlDiffRequest}
          fileEditorRequest={fileEditorRequest}
          onPanelDeleted={onPanelDeleted}
        />
      ) : (
        <WorkspaceEmptyState
          activeWorkspace={activeWorkspace}
          onPanelCreated={onPanelCreated}
          onTitleBarDoubleClick={handleTitleBarDoubleClick}
          onTitleBarMouseDown={handleTitleBarMouseDown}
        />
      )}
      {activeWorkspace.status === "active" &&
      activeWorkspace.projectSwitch.status === "switching" ? (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-10 flex justify-center motion-safe:animate-in motion-safe:fade-in-0">
          <output className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-xs">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />
            <span>Switching project…</span>
          </output>
        </div>
      ) : undefined}
      {activeWorkspace.status === "active" && activeWorkspace.projectSwitch.status === "error" ? (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-10 flex justify-center motion-safe:animate-in motion-safe:fade-in-0">
          <div
            role="alert"
            className="max-w-lg rounded-full border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-xs"
          >
            Project switch failed: {activeWorkspace.projectSwitch.message}
          </div>
        </div>
      ) : undefined}
      {titleBarError === undefined ? undefined : (
        <output className="sr-only">{titleBarError}</output>
      )}
    </main>
  );
}

type WorkspaceEmptyStateProps = {
  activeWorkspace: ActiveWorkspaceState;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  onTitleBarDoubleClick: (event: MouseEvent<HTMLElement>) => Promise<void>;
  onTitleBarMouseDown: (event: MouseEvent<HTMLElement>) => Promise<void>;
};

function WorkspaceEmptyState({
  activeWorkspace,
  onPanelCreated,
  onTitleBarDoubleClick,
  onTitleBarMouseDown,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label="Workspace title bar"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground select-none"
        onDoubleClick={(event) => {
          void onTitleBarDoubleClick(event);
        }}
        onMouseDown={(event) => {
          void onTitleBarMouseDown(event);
        }}
      />
      {emptyStateContent(activeWorkspace, onPanelCreated)}
    </div>
  );
}

function emptyStateContent(
  activeWorkspace: ActiveWorkspaceState,
  onPanelCreated: (panel: StoredWorkspacePanel) => void,
) {
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

  if (activeWorkspace.status === "active") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-dashed border-border p-6 text-center">
          <div className="font-medium text-foreground">No panels open</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Create a terminal panel to start working in this Project.
          </div>
          <Button
            type="button"
            className="mt-4"
            onClick={() => void createFirstTerminalPanel(activeWorkspace, onPanelCreated)}
          >
            <TerminalIcon aria-hidden="true" />
            New Terminal
          </Button>
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

async function createFirstTerminalPanel(
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  onPanelCreated: (panel: StoredWorkspacePanel) => void,
) {
  const panel = await createTerminalPanel({
    sessionId: activeWorkspace.session.id,
    title: "Terminal",
    workingDirectory: activeWorkspace.project.folderPath,
  });
  onPanelCreated(panel);
}

export { AppWorkspace };
