import { invoke } from "@tauri-apps/api/core";
import {
  DockviewReact,
  Orientation,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import {
  Bot,
  LayoutPanelTop,
  Loader2,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  PenLine,
  Plus,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AgentThreadPanel, type AgentThreadPanelParams } from "@/features/agent-thread";
import { FileEditorPanel, type FileEditorPanelParams } from "@/features/editor";
import {
  createAgentThreadPanel,
  createTerminalPanel,
  deleteTerminalSnapshot,
  deleteWorkspacePanel,
  renameWorkspacePanel,
  updateSessionLayout,
} from "@/features/projects/api/projectsApi";
import {
  SourceControlDiffPanel,
  type SourceControlDiffPanelParams,
} from "@/features/source-control/components/SourceControlDiffPanel";

import type {
  ActiveWorkspaceState,
  AgentThreadOpenRequest,
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
  panels: StoredWorkspacePanel[];
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  onPanelUpdated: (panel: StoredWorkspacePanel) => void;
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
          <DropdownMenuItem
            onClick={() =>
              void addAgentThreadPanel({
                containerApi,
                group,
                onPanelCreated,
                projectId,
                sessionId,
              })
            }
          >
            <Bot className="size-4 text-muted-foreground" />
            <span>New Agent Thread</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void addTerminalPanel({
                containerApi,
                group,
                onPanelCreated,
                sessionId,
                workingDirectory,
              })
            }
          >
            <TerminalIcon className="size-4 text-muted-foreground" />
            <span>New Terminal</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkspacePanelTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const panel = containerApi.getPanel(api.id);
  if (panel === undefined) {
    throw new Error(`Workspace Panel tab ${api.id} is missing its Dockview panel.`);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="flex h-full min-w-0 items-center px-2" />}>
        <span className="truncate">{api.title ?? api.id}</span>
      </ContextMenuTrigger>
      <WorkspacePanelContextMenuContent containerApi={containerApi} panel={panel} />
    </ContextMenu>
  );
}

function WorkspacePanelContextMenuContent({
  containerApi,
  panel,
}: {
  containerApi: IDockviewHeaderActionsProps["containerApi"];
  panel: NonNullable<IDockviewHeaderActionsProps["activePanel"]>;
}) {
  const {
    onPanelUpdated,
    panels: storedPanels,
    projectId,
    sessionId,
  } = useWorkspaceRuntimeContext();
  const [panelToRename, setPanelToRename] = useState<typeof panel>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panelToRename !== undefined) {
      const input = renameInputRef.current;
      if (input !== null) {
        input.focus();
      }
    }
  }, [panelToRename]);

  async function splitPanel(direction: "right" | "below") {
    containerApi.addGroup({ referencePanel: panel, direction });
    await persistWorkspaceLayout(containerApi, sessionId);
  }

  async function resetWorkspaceLayout() {
    containerApi.fromJSON(createFlatWorkspaceLayout(storedPanels, projectId, sessionId, panel.id), {
      reuseExistingPanels: true,
    });
    await persistWorkspaceLayout(containerApi, sessionId);
  }

  async function renamePanel() {
    if (panelToRename === undefined) {
      throw new Error("A Workspace Panel is required before it can be renamed.");
    }

    const title = renameTitle.trim();
    if (title.length === 0) {
      setRenameError("Panel title is required.");
      return;
    }

    const updatedPanel = await renameWorkspacePanel({ panelId: panelToRename.id, title });
    panelToRename.api.setTitle(updatedPanel.title);
    onPanelUpdated(updatedPanel);
    await persistWorkspaceLayout(containerApi, sessionId);
    setPanelToRename(undefined);
    setRenameTitle("");
    setRenameError(undefined);
  }

  function openRenameDialog() {
    setPanelToRename(panel);
    setRenameTitle(panel.title ?? panel.id);
    setRenameError(undefined);
  }

  function closeOtherPanels() {
    for (const candidatePanel of panel.group.panels) {
      if (candidatePanel.id !== panel.id) {
        candidatePanel.api.close();
      }
    }
  }

  return (
    <>
      <ContextMenuContent className="w-auto min-w-48">
        <ContextMenuItem onClick={openRenameDialog}>
          <PenLine className="size-4 text-muted-foreground" />
          <span>Rename Panel</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => panel.api.close()}>
          <X className="size-4 text-muted-foreground" />
          <span>Close Panel</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={closeOtherPanels}>
          <X className="size-4 text-muted-foreground" />
          <span>Close Others</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void splitPanel("right")}>
          <PanelRight className="size-4 text-muted-foreground" />
          <span>Split Right</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void splitPanel("below")}>
          <PanelBottom className="size-4 text-muted-foreground" />
          <span>Split Down</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => panel.group.api.close()}>
          <X className="size-4 text-muted-foreground" />
          <span>Close All in Group</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void resetWorkspaceLayout()}>
          <LayoutPanelTop className="size-4 text-muted-foreground" />
          <span>Reset Workspace Layout</span>
        </ContextMenuItem>
      </ContextMenuContent>
      <RenamePanelDialog
        error={renameError}
        inputRef={renameInputRef}
        open={panelToRename !== undefined}
        title={renameTitle}
        onOpenChange={(open) => !open && setPanelToRename(undefined)}
        onSubmit={() => void renamePanel()}
        onTitleChange={(title) => {
          setRenameTitle(title);
          setRenameError(undefined);
        }}
      />
    </>
  );
}

type RenamePanelDialogProps = {
  error: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onTitleChange: (title: string) => void;
};

function RenamePanelDialog({
  error,
  inputRef,
  open,
  title,
  onOpenChange,
  onSubmit,
  onTitleChange,
}: RenamePanelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Panel</DialogTitle>
          <DialogDescription>Choose the title shown in the Workspace tab bar.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Input
            ref={inputRef}
            aria-label="Panel title"
            aria-invalid={error !== undefined}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
          {error === undefined ? undefined : <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceGroupActions({
  activePanel,
  containerApi,
  group,
  panels,
}: IDockviewHeaderActionsProps) {
  const {
    onPanelUpdated,
    panels: storedPanels,
    projectId,
    sessionId,
  } = useWorkspaceRuntimeContext();
  const [panelToRename, setPanelToRename] = useState<typeof activePanel>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();

  async function splitGroup(direction: "right" | "below") {
    containerApi.addGroup({ referenceGroup: group, direction });
    await persistWorkspaceLayout(containerApi, sessionId);
  }

  async function resetWorkspaceLayout() {
    const activePanelId = activePanel === undefined ? undefined : activePanel.id;
    containerApi.fromJSON(
      createFlatWorkspaceLayout(storedPanels, projectId, sessionId, activePanelId),
      {
        reuseExistingPanels: true,
      },
    );
    await persistWorkspaceLayout(containerApi, sessionId);
  }

  async function renamePanel() {
    if (panelToRename === undefined) {
      throw new Error("A Workspace Panel is required before it can be renamed.");
    }

    const title = renameTitle.trim();
    if (title.length === 0) {
      setRenameError("Panel title is required.");
      return;
    }

    const panel = await renameWorkspacePanel({ panelId: panelToRename.id, title });
    panelToRename.api.setTitle(panel.title);
    onPanelUpdated(panel);
    await persistWorkspaceLayout(containerApi, sessionId);
    setPanelToRename(undefined);
    setRenameTitle("");
    setRenameError(undefined);
  }

  function openRenameDialog() {
    if (activePanel === undefined) {
      throw new Error("An active Workspace Panel is required before it can be renamed.");
    }

    setPanelToRename(activePanel);
    setRenameTitle(activePanel.title ?? activePanel.id);
    setRenameError(undefined);
  }

  function closeOtherPanels() {
    if (activePanel === undefined) {
      throw new Error("An active Workspace Panel is required before other panels can be closed.");
    }

    for (const panel of panels) {
      if (panel.id !== activePanel.id) {
        panel.api.close();
      }
    }
  }

  return (
    <div className="flex h-full items-center px-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Workspace panel actions"
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem disabled={activePanel === undefined} onClick={openRenameDialog}>
            <PenLine className="size-4 text-muted-foreground" />
            <span>Rename Panel</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={activePanel === undefined}
            onClick={() => closeActivePanel(activePanel)}
          >
            <X className="size-4 text-muted-foreground" />
            <span>Close Panel</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={activePanel === undefined} onClick={closeOtherPanels}>
            <X className="size-4 text-muted-foreground" />
            <span>Close Others</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void splitGroup("right")}>
            <PanelRight className="size-4 text-muted-foreground" />
            <span>Split Right</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void splitGroup("below")}>
            <PanelBottom className="size-4 text-muted-foreground" />
            <span>Split Down</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => group.api.close()}>
            <X className="size-4 text-muted-foreground" />
            <span>Close All in Group</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void resetWorkspaceLayout()}>
            <LayoutPanelTop className="size-4 text-muted-foreground" />
            <span>Reset Workspace Layout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={panelToRename !== undefined}
        onOpenChange={(open) => !open && setPanelToRename(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Panel</DialogTitle>
            <DialogDescription>Choose the title shown in the Workspace tab bar.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void renamePanel();
            }}
          >
            <Input
              aria-label="Panel title"
              aria-invalid={renameError !== undefined}
              value={renameTitle}
              onChange={(event) => {
                setRenameTitle(event.target.value);
                setRenameError(undefined);
              }}
            />
            {renameError === undefined ? undefined : (
              <p className="text-sm text-destructive">{renameError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setPanelToRename(undefined)}>
                Cancel
              </Button>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function closeActivePanel(activePanel: IDockviewHeaderActionsProps["activePanel"]) {
  if (activePanel === undefined) {
    throw new Error("An active Workspace Panel is required before it can be closed.");
  }

  activePanel.api.close();
}

const workspaceComponents = {
  workspacePanel: WorkspacePanel,
  terminalPanel: TerminalPanel,
  sourceControlDiffPanel: SourceControlDiffPanel,
  fileEditorPanel: FileEditorPanel,
  agentThreadPanel: AgentThreadPanel,
};

const runtimeOnlyWorkspaceComponents = new Set<string>();

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

function requireAgentThreadState(panel: StoredWorkspacePanel) {
  if (panel.kind !== "agent_thread") {
    throw new Error(`Workspace panel ${panel.id} is not an Agent Thread panel.`);
  }

  return panel.agentThreadState;
}

function useWorkspaceRuntimeContext() {
  const context = useContext(WorkspaceRuntimeContext);
  if (context === undefined) {
    throw new Error("Workspace runtime context is required.");
  }

  return context;
}

type AddPanelActionInput = Pick<
  WorkspaceRuntimeContextValue,
  "onPanelCreated" | "projectId" | "sessionId" | "workingDirectory"
> &
  Pick<IDockviewHeaderActionsProps, "containerApi" | "group">;

async function addTerminalPanel({
  containerApi,
  group,
  onPanelCreated,
  sessionId,
  workingDirectory,
}: Omit<AddPanelActionInput, "projectId">) {
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
  await persistWorkspaceLayout(containerApi, sessionId);
}

async function addAgentThreadPanel({
  containerApi,
  group,
  onPanelCreated,
  projectId,
  sessionId,
}: Omit<AddPanelActionInput, "workingDirectory">) {
  const panel = await createAgentThreadPanel({
    sessionId,
    title: "Agent Thread",
  });
  const agentThreadState = requireAgentThreadState(panel);
  onPanelCreated(panel);
  containerApi.addPanel<AgentThreadPanelParams>({
    id: panel.id,
    component: "agentThreadPanel",
    title: panel.title,
    params: {
      projectId,
      sessionId,
      threadId: agentThreadState.threadId,
    },
    position: {
      referenceGroup: group,
      direction: "within",
    },
  });
  await persistWorkspaceLayout(containerApi, sessionId);
}

async function persistWorkspaceLayout(
  containerApi: IDockviewHeaderActionsProps["containerApi"],
  sessionId: string,
) {
  await updateSessionLayout({
    sessionId,
    layoutJson: serializeWorkspaceLayoutForPersistence(containerApi.toJSON()),
  });
}

function createFlatWorkspaceLayout(
  panels: StoredWorkspacePanel[],
  projectId: string,
  sessionId: string,
  activePanelId: string | undefined,
): Parameters<IDockviewHeaderActionsProps["containerApi"]["fromJSON"]>[0] {
  const panelStates = Object.fromEntries(
    panels.map((panel) => [panel.id, createStoredPanelState(panel, projectId, sessionId)]),
  );
  const panelIds = panels.map((panel) => panel.id);
  const activeView = activePanelId ?? panelIds[0];
  const groupState =
    activeView === undefined
      ? { id: "workspace-reset-group", views: panelIds }
      : { id: "workspace-reset-group", views: panelIds, activeView };

  return {
    grid: {
      root: {
        type: "leaf",
        data: groupState,
      },
      height: 0,
      width: 0,
      orientation: Orientation.HORIZONTAL,
    },
    panels: panelStates,
    activeGroup: "workspace-reset-group",
  };
}

function createStoredPanelState(panel: StoredWorkspacePanel, projectId: string, sessionId: string) {
  switch (panel.kind) {
    case "terminal": {
      const terminalState = requireTerminalState(panel);
      return {
        id: panel.id,
        contentComponent: "terminalPanel",
        title: panel.title,
        params: {
          terminalId: panel.id,
          workingDirectory: terminalState.workingDirectory,
        },
      };
    }
    case "source_control_diff":
      return {
        id: panel.id,
        contentComponent: "sourceControlDiffPanel",
        title: panel.title,
        params: requireSourceControlDiffState(panel),
      };
    case "file_editor":
      return {
        id: panel.id,
        contentComponent: "fileEditorPanel",
        title: panel.title,
        params: requireFileEditorState(panel),
      };
    case "agent_thread": {
      const agentThreadState = requireAgentThreadState(panel);
      return {
        id: panel.id,
        contentComponent: "agentThreadPanel",
        title: panel.title,
        params: {
          projectId,
          sessionId,
          threadId: agentThreadState.threadId,
        },
      };
    }
  }
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
      const restoredMissingPanels = restoreMissingStoredPanels(
        event,
        activeWorkspace,
        activeWorkspace.panels,
      );
      if (restoredMissingPanels) {
        void saveWorkspaceLayoutIfActive(
          activeWorkspace.session.id,
          event,
          isWorkspaceDisposingRef,
        );
      }
    } catch {
      restorePanelsWithoutLayout(event, activeWorkspace, activeWorkspace.panels);
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
    }
  } else {
    restorePanelsWithoutLayout(event, activeWorkspace, activeWorkspace.panels);
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

    if (storedPanel.kind === "agent_thread") {
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
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

function restoreMissingStoredPanels(
  event: DockviewReadyEvent,
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  panels: StoredWorkspacePanel[],
) {
  let restoredAnyPanel = false;

  for (const panel of panels) {
    if (event.api.getPanel(panel.id) !== undefined || panel.kind === "agent_thread") {
      continue;
    }

    restoreWorkspacePanel(event, activeWorkspace, panel);
    restoredAnyPanel = true;
  }

  return restoredAnyPanel;
}

function restorePanelsWithoutLayout(
  event: DockviewReadyEvent,
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  panels: StoredWorkspacePanel[],
) {
  for (const panel of panels) {
    restoreWorkspacePanel(event, activeWorkspace, panel);
  }
}

function restoreWorkspacePanel(
  event: DockviewReadyEvent,
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  panel: StoredWorkspacePanel,
) {
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
    case "agent_thread": {
      const agentThreadState = requireAgentThreadState(panel);
      event.api.addPanel<AgentThreadPanelParams>({
        id: panel.id,
        component: "agentThreadPanel",
        title: panel.title,
        params: {
          projectId: activeWorkspace.project.id,
          sessionId: activeWorkspace.session.id,
          threadId: agentThreadState.threadId,
        },
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
  onPanelUpdated: (panel: StoredWorkspacePanel) => void;
  sourceControlDiffRequest: SourceControlDiffOpenRequest | undefined;
  fileEditorRequest: FileEditorOpenRequest | undefined;
  agentThreadRequest: AgentThreadOpenRequest | undefined;
  onPanelDeleted: (panelId: string) => void;
};

function ActiveWorkspaceDockview({
  activeWorkspace,
  isWorkspaceDisposingRef,
  onPanelCreated,
  onPanelUpdated,
  sourceControlDiffRequest,
  fileEditorRequest,
  agentThreadRequest,
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
      panels: activeWorkspace.panels,
      onPanelCreated,
      onPanelUpdated,
    }),
    [activeWorkspace, onPanelCreated, onPanelUpdated],
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

  useEffect(() => {
    if (dockviewApi === undefined || agentThreadRequest === undefined) {
      return;
    }

    const panel = activeWorkspace.panels.find(
      (workspacePanel) => workspacePanel.id === agentThreadRequest.panel.id,
    );
    if (panel === undefined || panel.kind !== "agent_thread") {
      return;
    }

    const existingPanel = dockviewApi.getPanel(panel.id);
    if (existingPanel !== undefined) {
      existingPanel.api.setActive();
      return;
    }

    dockviewApi.addPanel<AgentThreadPanelParams>({
      id: panel.id,
      component: "agentThreadPanel",
      title: panel.title,
      params: {
        projectId: activeWorkspace.project.id,
        sessionId: activeWorkspace.session.id,
        threadId: panel.agentThreadState.threadId,
      },
    });
  }, [activeWorkspace, agentThreadRequest, dockviewApi]);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      <WorkspaceRuntimeContext.Provider value={workspaceRuntimeContext}>
        <DockviewReact
          key={activeWorkspace.session.id}
          className="dockview-theme-dark kira-dockview"
          components={workspaceComponents}
          defaultHeaderPosition="top"
          defaultTabComponent={WorkspacePanelTab}
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
          rightHeaderActionsComponent={WorkspaceGroupActions}
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
  agentThreadRequest: AgentThreadOpenRequest | undefined;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  onPanelUpdated: (panel: StoredWorkspacePanel) => void;
  onPanelDeleted: (panelId: string) => void;
};

function AppWorkspace({
  activeWorkspace,
  sourceControlDiffRequest,
  fileEditorRequest,
  agentThreadRequest,
  onPanelCreated,
  onPanelUpdated,
  onPanelDeleted,
}: AppWorkspaceProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const isWorkspaceDisposingRef = useRef(false);
  isWorkspaceDisposingRef.current = activeWorkspace.status !== "active";

  return (
    <main className="relative h-full min-h-0 min-w-0 overflow-hidden bg-editor-surface">
      {activeWorkspace.status === "active" && activeWorkspace.panels.length > 0 ? (
        <ActiveWorkspaceDockview
          activeWorkspace={activeWorkspace}
          isWorkspaceDisposingRef={isWorkspaceDisposingRef}
          onPanelCreated={onPanelCreated}
          onPanelUpdated={onPanelUpdated}
          sourceControlDiffRequest={sourceControlDiffRequest}
          fileEditorRequest={fileEditorRequest}
          agentThreadRequest={agentThreadRequest}
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
