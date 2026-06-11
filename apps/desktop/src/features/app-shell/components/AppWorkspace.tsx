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
  Globe,
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
  useSyncExternalStore,
  type DragEvent,
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
import { useAgentThreadTitleGenerationState } from "@/features/agent-thread/agentThreadStatusStore";
import { BrowserPanel, type BrowserPanelParams } from "@/features/browser";
import { closeBrowserPanel, closeOrphanBrowserPanels } from "@/features/browser/api/browserApi";
import { FileEditorPanel, type FileEditorPanelParams } from "@/features/editor";
import { explorerDragDataKey } from "@/features/explorer";
import {
  createAgentThreadPanel,
  createBrowserPanel,
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
  AgentThreadOperationRequest,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
} from "../types";

import { TerminalPanel, type TerminalPanelParams } from "./TerminalPanel";
import { ThreadTitleText } from "./ThreadTitleText";
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
                workingDirectory,
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
          <DropdownMenuItem
            onClick={() =>
              void addBrowserPanel({
                containerApi,
                group,
                onPanelCreated,
                sessionId,
              })
            }
          >
            <Globe className="size-4 text-muted-foreground" />
            <span>New Browser</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
function WorkspacePanelTab({ api, containerApi, params }: IDockviewPanelHeaderProps) {
  const title = useSyncExternalStore(
    (callback) => {
      const disposable = api.onDidTitleChange(() => callback());
      return () => disposable.dispose();
    },
    () => api.title ?? api.id,
  );
  const threadId = agentThreadIdFromPanelParams(params);
  const titleGeneration = useAgentThreadTitleGenerationState(threadId);
  const isGeneratingTitle = titleGeneration.status === "generating";
  const panel = containerApi.getPanel(api.id);
  if (panel === undefined) {
    throw new Error(`Workspace Panel tab ${api.id} is missing its Dockview panel.`);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div className="group relative flex h-full min-w-0 items-center px-2 pr-6" />}
      >
        <ThreadTitleText isGenerating={isGeneratingTitle} text={title} />
        <button
          aria-label={`Close ${title}`}
          className="absolute right-1 rounded-sm p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
          type="button"
          onClick={(event) => closePanelFromTab(event, panel)}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <X className="size-3" />
        </button>
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
    const splitGroup = containerApi.addGroup({ referencePanel: panel, direction });
    panel.api.moveTo({ group: splitGroup });
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
    closePanelsExcept(panel);
  }

  function closePanelsToRight() {
    closePanelsAfter(panel);
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
        <ContextMenuItem disabled={!hasPanelsAfter(panel)} onClick={closePanelsToRight}>
          <X className="size-4 text-muted-foreground" />
          <span>Close Panels to the Right</span>
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

function WorkspaceGroupActions({ activePanel, containerApi, group }: IDockviewHeaderActionsProps) {
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

    closePanelsExcept(activePanel);
  }

  function closeActivePanelsToRight() {
    if (activePanel === undefined) {
      throw new Error(
        "An active Workspace Panel is required before panels to the right can be closed.",
      );
    }

    closePanelsAfter(activePanel);
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
          <DropdownMenuItem
            disabled={!hasPanelsAfter(activePanel)}
            onClick={closeActivePanelsToRight}
          >
            <X className="size-4 text-muted-foreground" />
            <span>Close Panels to the Right</span>
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

function closePanelFromTab(
  event: MouseEvent<HTMLButtonElement>,
  panel: NonNullable<IDockviewHeaderActionsProps["activePanel"]>,
) {
  event.preventDefault();
  event.stopPropagation();
  panel.api.close();
}

function hasPanelsAfter(panel: IDockviewHeaderActionsProps["activePanel"]) {
  if (panel === undefined) {
    return false;
  }

  return panelIndexInGroup(panel) < panel.group.panels.length - 1;
}

function closePanelsExcept(panel: NonNullable<IDockviewHeaderActionsProps["activePanel"]>) {
  const panelsToClose = panel.group.panels.filter(
    (candidatePanel) => candidatePanel.id !== panel.id,
  );
  for (const panelToClose of panelsToClose) {
    panelToClose.api.close();
  }
}

function closePanelsAfter(panel: NonNullable<IDockviewHeaderActionsProps["activePanel"]>) {
  const startIndex = panelIndexInGroup(panel) + 1;
  for (const panelToClose of panel.group.panels.slice(startIndex)) {
    panelToClose.api.close();
  }
}

function panelIndexInGroup(panel: NonNullable<IDockviewHeaderActionsProps["activePanel"]>) {
  const panelIndex = panel.group.panels.findIndex(
    (candidatePanel) => candidatePanel.id === panel.id,
  );
  if (panelIndex === -1) {
    throw new Error(`Workspace Panel ${panel.id} is missing from its Dockview group.`);
  }

  return panelIndex;
}

const emptyWorkspacePanelId = "workspace-empty-state";

const runtimeOnlyWorkspaceComponents = new Set<string>(["workspacePanel"]);
const agentThreadRenameRef = {
  current: undefined as ((panelId: string, title: string) => Promise<void>) | undefined,
};

function AgentThreadPanelWrapper(props: IDockviewPanelProps<AgentThreadPanelParams>) {
  const { workingDirectory } = useWorkspaceRuntimeContext();
  const onRename = agentThreadRenameRef.current;
  return (
    <AgentThreadPanel
      api={props.api}
      params={{ ...props.params, folderPath: workingDirectory }}
      {...(onRename === undefined ? {} : { onRename })}
    />
  );
}

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

function requireBrowserState(panel: StoredWorkspacePanel) {
  if (panel.kind !== "browser") {
    throw new Error(`Workspace panel ${panel.id} is not a browser panel.`);
  }

  return panel.browserState;
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
  removeEmptyWorkspacePanel(containerApi);
  await persistWorkspaceLayout(containerApi, sessionId);
}

async function addAgentThreadPanel({
  containerApi,
  group,
  onPanelCreated,
  projectId,
  sessionId,
  workingDirectory,
}: AddPanelActionInput) {
  const panel = await createAgentThreadPanel({
    sessionId,
    title: "New Thread",
  });
  const agentThreadState = requireAgentThreadState(panel);
  onPanelCreated(panel);
  containerApi.addPanel<AgentThreadPanelParams>({
    id: panel.id,
    component: "agentThreadPanel",
    title: panel.title,
    params: {
      projectId,
      folderPath: workingDirectory,
      sessionId,
      threadId: agentThreadState.threadId,
      panelId: panel.id,
      title: panel.title,
    },
    position: {
      referenceGroup: group,
      direction: "within",
    },
  });
  removeEmptyWorkspacePanel(containerApi);
  await persistWorkspaceLayout(containerApi, sessionId);
}

async function addBrowserPanel({
  containerApi,
  group,
  onPanelCreated,
  sessionId,
}: Omit<AddPanelActionInput, "projectId" | "workingDirectory">) {
  const panel = await createBrowserPanel({
    sessionId,
    title: "Browser",
    url: "https://example.com",
  });
  const browserState = requireBrowserState(panel);
  onPanelCreated(panel);
  containerApi.addPanel<BrowserPanelParams>({
    id: panel.id,
    component: "browserPanel",
    title: panel.title,
    params: {
      panelId: panel.id,
      url: browserState.url,
    },
    position: {
      referenceGroup: group,
      direction: "within",
    },
  });
  removeEmptyWorkspacePanel(containerApi);
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
          panelId: panel.id,
          title: panel.title,
        },
      };
    }
    case "browser": {
      const browserState = requireBrowserState(panel);
      return {
        id: panel.id,
        contentComponent: "browserPanel",
        title: panel.title,
        params: {
          panelId: panel.id,
          url: browserState.url,
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
function agentThreadIdFromPanelParams(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return void 0;
  }

  const threadId = params.threadId;
  if (typeof threadId === "string") {
    return threadId;
  }

  return void 0;
}

function restoreWorkspacePanels(
  event: DockviewReadyEvent,
  activeWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
  panelsRef: RefObject<StoredWorkspacePanel[]>,
  onPanelDeleted: (panelId: string) => void,
  isWorkspaceDisposingRef: RefObject<boolean>,
  deletedPanelIdsRef: RefObject<Set<string>>,
) {
  preventHeaderSpaceDrag(event);

  void closeOrphanBrowserPanels(
    activeWorkspace.panels.filter((panel) => panel.kind === "browser").map((panel) => panel.id),
  );

  if (activeWorkspace.panels.length === 0) {
    addEmptyWorkspacePanel(event.api);
  } else if (activeWorkspace.session.layoutJson !== null) {
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
      addEmptyWorkspacePanelWhenWorkspaceHasNoVisiblePanels(event);
      return;
    }

    if (storedPanel.kind === "agent_thread") {
      if (deletedPanelIdsRef.current.has(panel.id)) {
        deletedPanelIdsRef.current.delete(panel.id);
        onPanelDeleted(panel.id);
      }
      addEmptyWorkspacePanelWhenWorkspaceHasNoVisiblePanels(event);
      void saveWorkspaceLayoutIfActive(activeWorkspace.session.id, event, isWorkspaceDisposingRef);
      return;
    }
    if (storedPanel.kind === "browser") {
      void closeBrowserPanel(panel.id);
    }

    if (storedPanel.kind === "terminal") {
      void killTerminalSession(panel.id);
      void deleteTerminalSnapshot({ terminalId: panel.id });
    }

    onPanelDeleted(panel.id);
    void deleteWorkspacePanel({ panelId: panel.id });
    addEmptyWorkspacePanelWhenWorkspaceHasNoVisiblePanels(event);
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

function addEmptyWorkspacePanelWhenWorkspaceHasNoVisiblePanels(event: DockviewReadyEvent) {
  if (hasVisibleWorkspacePanel(event.api)) {
    return;
  }

  addEmptyWorkspacePanel(event.api);
}

function addEmptyWorkspacePanel(containerApi: IDockviewHeaderActionsProps["containerApi"]) {
  if (
    containerApi.getPanel(emptyWorkspacePanelId) !== undefined ||
    hasVisibleWorkspacePanel(containerApi)
  ) {
    return;
  }

  containerApi.addPanel<WorkspacePanelParams>({
    id: emptyWorkspacePanelId,
    component: "workspacePanel",
    title: "Workspace",
    params: {
      description: "Create a panel from the tab bar to start working in this Project.",
    },
  });
}

function hasVisibleWorkspacePanel(containerApi: IDockviewHeaderActionsProps["containerApi"]) {
  const layout = requireObjectRecord(containerApi.toJSON(), "Workspace layout");
  const panels = requireObjectRecord(layout.panels, "Workspace layout panels");
  return Object.keys(panels).some((panelId) => panelId !== emptyWorkspacePanelId);
}

function removeEmptyWorkspacePanel(containerApi: IDockviewHeaderActionsProps["containerApi"]) {
  const emptyPanel = containerApi.getPanel(emptyWorkspacePanelId);
  if (emptyPanel === undefined) {
    return;
  }

  emptyPanel.api.close();
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
          folderPath: activeWorkspace.project.folderPath,
          sessionId: activeWorkspace.session.id,
          threadId: agentThreadState.threadId,
          panelId: panel.id,
          title: panel.title,
        },
      });
      return;
    }
    case "browser": {
      const browserState = requireBrowserState(panel);
      event.api.addPanel<BrowserPanelParams>({
        id: panel.id,
        component: "browserPanel",
        title: panel.title,
        params: {
          panelId: panel.id,
          url: browserState.url,
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
  agentThreadOperationRequest: AgentThreadOperationRequest | undefined;
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
  agentThreadOperationRequest,
  onPanelDeleted,
}: ActiveWorkspaceDockviewProps) {
  const [dockviewApi, setDockviewApi] = useState<DockviewReadyEvent["api"]>();
  const panelsRef = useRef(activeWorkspace.panels);
  panelsRef.current = activeWorkspace.panels;
  const deletedPanelIdsRef = useRef<Set<string>>(new Set());
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
  const onPanelUpdatedRef = useRef(onPanelUpdated);
  onPanelUpdatedRef.current = onPanelUpdated;

  agentThreadRenameRef.current = async (panelId: string, title: string) => {
    const updatedPanel = await renameWorkspacePanel({ panelId, title });
    onPanelUpdatedRef.current(updatedPanel);
    const dockviewPanel = dockviewApi === undefined ? undefined : dockviewApi.getPanel(panelId);
    if (dockviewPanel !== undefined) {
      dockviewPanel.api.setTitle(title);
    }
  };

  const components = useMemo(
    () => ({
      workspacePanel: WorkspacePanel,
      terminalPanel: TerminalPanel,
      sourceControlDiffPanel: SourceControlDiffPanel,
      fileEditorPanel: FileEditorPanel,
      agentThreadPanel: AgentThreadPanelWrapper,
      browserPanel: BrowserPanel,
    }),
    [],
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
    removeEmptyWorkspacePanel(dockviewApi);
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

    const params = {
      ...panel.fileEditorState,
      focusRequest: fileEditorRequest.focusRequest,
    } satisfies FileEditorPanelParams;

    const existingPanel = dockviewApi.getPanel(panel.id);
    if (existingPanel !== undefined) {
      existingPanel.api.updateParameters(params);
      existingPanel.api.setActive();
      return;
    }

    dockviewApi.addPanel<FileEditorPanelParams>({
      id: panel.id,
      component: "fileEditorPanel",
      title: panel.title,
      params,
    });
    removeEmptyWorkspacePanel(dockviewApi);
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
        folderPath: activeWorkspace.project.folderPath,
        sessionId: activeWorkspace.session.id,
        threadId: panel.agentThreadState.threadId,
        panelId: panel.id,
        title: panel.title,
      },
    });
    removeEmptyWorkspacePanel(dockviewApi);
  }, [activeWorkspace, agentThreadRequest, dockviewApi]);

  useEffect(() => {
    if (dockviewApi === undefined || agentThreadOperationRequest === undefined) {
      return;
    }

    const panel = activeWorkspace.panels.find(
      (workspacePanel) => workspacePanel.id === agentThreadOperationRequest.panelId,
    );
    if (panel === undefined && agentThreadOperationRequest.operation !== "delete") {
      throw new Error(`Expected Agent Thread panel ${agentThreadOperationRequest.panelId}.`);
    }
    if (panel !== undefined && panel.kind !== "agent_thread") {
      throw new Error(`Expected Agent Thread panel ${agentThreadOperationRequest.panelId}.`);
    }

    const dockviewPanel = dockviewApi.getPanel(agentThreadOperationRequest.panelId);

    if (agentThreadOperationRequest.operation === "rename") {
      if (agentThreadOperationRequest.title === undefined) {
        throw new Error("A title is required to rename an Agent Thread panel.");
      }
      if (dockviewPanel !== undefined) {
        dockviewPanel.api.setTitle(agentThreadOperationRequest.title);
      }
      return;
    }

    if (agentThreadOperationRequest.operation === "close") {
      if (dockviewPanel !== undefined) {
        dockviewPanel.api.close();
      }
      return;
    }

    if (agentThreadOperationRequest.operation === "delete") {
      deletedPanelIdsRef.current.add(agentThreadOperationRequest.panelId);
      if (dockviewPanel !== undefined) {
        dockviewPanel.api.close();
      }
      if (dockviewPanel === undefined) {
        deletedPanelIdsRef.current.delete(agentThreadOperationRequest.panelId);
      }
      return;
    }

    assertNever(agentThreadOperationRequest.operation);
  }, [activeWorkspace.panels, agentThreadOperationRequest, dockviewApi]);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden" onDragOver={preventExplorerDragDefault}>
      <WorkspaceRuntimeContext.Provider value={workspaceRuntimeContext}>
        <DockviewReact
          key={activeWorkspace.session.id}
          className="dockview-theme-dark kira-dockview"
          components={components}
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
              deletedPanelIdsRef,
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

  const component = value.component ?? value.contentComponent;
  return typeof component === "string" && runtimeOnlyWorkspaceComponents.has(component);
}

function preventExplorerDragDefault(event: DragEvent<HTMLDivElement>) {
  if (!event.dataTransfer.types.includes(explorerDragDataKey)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Agent Thread operation: ${value}`);
}

type AppWorkspaceProps = {
  activeWorkspace: ActiveWorkspaceState;
  sourceControlDiffRequest: SourceControlDiffOpenRequest | undefined;
  fileEditorRequest: FileEditorOpenRequest | undefined;
  agentThreadRequest: AgentThreadOpenRequest | undefined;
  agentThreadOperationRequest: AgentThreadOperationRequest | undefined;
  onPanelCreated: (panel: StoredWorkspacePanel) => void;
  onPanelUpdated: (panel: StoredWorkspacePanel) => void;
  onPanelDeleted: (panelId: string) => void;
};

function AppWorkspace({
  activeWorkspace,
  sourceControlDiffRequest,
  fileEditorRequest,
  agentThreadRequest,
  agentThreadOperationRequest,
  onPanelCreated,
  onPanelUpdated,
  onPanelDeleted,
}: AppWorkspaceProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const isWorkspaceDisposingRef = useRef(false);
  isWorkspaceDisposingRef.current = activeWorkspace.status !== "active";

  return (
    <main className="relative h-full min-h-0 min-w-0 overflow-hidden bg-editor-surface">
      {activeWorkspace.status === "active" ? (
        <ActiveWorkspaceDockview
          activeWorkspace={activeWorkspace}
          isWorkspaceDisposingRef={isWorkspaceDisposingRef}
          onPanelCreated={onPanelCreated}
          onPanelUpdated={onPanelUpdated}
          sourceControlDiffRequest={sourceControlDiffRequest}
          fileEditorRequest={fileEditorRequest}
          agentThreadRequest={agentThreadRequest}
          agentThreadOperationRequest={agentThreadOperationRequest}
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
