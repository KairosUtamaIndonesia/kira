import { useEffect, useRef, useState } from "react";

import type {
  CreatedProject,
  OpenProject,
  Project,
  WorkspacePanel,
} from "@/features/projects/types";
import type { GitStatusEntry } from "@/features/source-control/types";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { toast } from "@/components/ui/sonner";
import { startAgentRuntime } from "@/features/agent-thread/api/agentRuntimeApi";
import {
  deleteWorkspacePanel,
  openFileEditorPanel,
  openLastProject,
  openProject,
  openProjectSession,
  openSourceControlDiffPanel,
  renameWorkspacePanel,
} from "@/features/projects/api/projectsApi";
import { SettingsPage } from "@/features/settings";

import type {
  ActiveWorkspaceState,
  AgentThreadOpenRequest,
  AgentThreadOperationRequest,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
} from "../types";

import { AppInspector } from "./AppInspector";
import { AppSidebar } from "./AppSidebar";
import { AppStatusBar } from "./AppStatusBar";
import { AppWorkspace } from "./AppWorkspace";

type SettingsSurfaceState = "closed" | "opening" | "open" | "closing";

function fileTitle(filePath: string) {
  const pathParts = filePath.split("/");
  const title = pathParts[pathParts.length - 1];
  if (title === undefined || title.length === 0) {
    return filePath;
  }

  return title;
}

function AppShell() {
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspaceState>({ status: "none" });
  const [sourceControlDiffRequest, setSourceControlDiffRequest] =
    useState<SourceControlDiffOpenRequest>();
  const [fileEditorRequest, setFileEditorRequest] = useState<FileEditorOpenRequest>();
  const [agentThreadRequest, setAgentThreadRequest] = useState<AgentThreadOpenRequest>();
  const [agentThreadOperationRequest, setAgentThreadOperationRequest] =
    useState<AgentThreadOperationRequest>();
  const [settingsSurfaceState, setSettingsSurfaceState] = useState<SettingsSurfaceState>("closed");
  const projectSwitchSequenceRef = useRef(0);
  const sourceControlDiffSequenceRef = useRef(0);
  const fileEditorSequenceRef = useRef(0);
  const agentThreadSequenceRef = useRef(0);
  const settingsReturnFocusRef = useRef<HTMLElement | undefined>(void 0);

  useEffect(() => {
    async function startRuntime() {
      try {
        await startAgentRuntime();
      } catch (error) {
        toast.error(`Agent runtime failed to start: ${errorMessageFromUnknown(error)}`);
      }
    }

    void startRuntime();
  }, []);

  useEffect(() => {
    let ignoreResult = false;

    async function restoreLastProject() {
      try {
        const lastProject = await openLastProject();
        if (ignoreResult || lastProject === null) {
          return;
        }

        setActiveWorkspace({ status: "active", projectSwitch: { status: "idle" }, ...lastProject });
      } catch (error) {
        if (!ignoreResult) {
          setActiveWorkspace({
            status: "error",
            projectId: "last-opened-project",
            message: errorMessageFromUnknown(error),
          });
        }
      }
    }

    void restoreLastProject();

    return () => {
      ignoreResult = true;
    };
  }, []);

  async function handleProjectSelect(projectId: string) {
    await openWorkspaceProject(
      projectId,
      (currentWorkspace) => currentWorkspace.project.id === projectId,
      () => openProject({ projectId }),
    );
  }

  async function handleSessionSelect(projectId: string, sessionId: string) {
    await openWorkspaceProject(
      projectId,
      (currentWorkspace) =>
        currentWorkspace.project.id === projectId && currentWorkspace.session.id === sessionId,
      () => openProjectSession({ projectId, sessionId }),
    );
  }

  async function openWorkspaceProject(
    projectId: string,
    shouldSkipOpen: (
      currentWorkspace: Extract<ActiveWorkspaceState, { status: "active" }>,
    ) => boolean,
    openProjectRequest: () => Promise<OpenProject>,
  ) {
    let shouldOpenProject = true;
    const switchSequence = projectSwitchSequenceRef.current + 1;

    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status === "active") {
        if (shouldSkipOpen(currentWorkspace)) {
          shouldOpenProject = false;
          return currentWorkspace;
        }

        projectSwitchSequenceRef.current = switchSequence;
        return {
          ...currentWorkspace,
          projectSwitch: { status: "switching", projectId },
        };
      }

      projectSwitchSequenceRef.current = switchSequence;
      return { status: "loading", projectId };
    });

    if (!shouldOpenProject) {
      return;
    }

    try {
      const openedProject = await openProjectRequest();
      if (projectSwitchSequenceRef.current !== switchSequence) {
        return;
      }

      setActiveWorkspace({ status: "active", projectSwitch: { status: "idle" }, ...openedProject });
    } catch (error) {
      if (projectSwitchSequenceRef.current !== switchSequence) {
        return;
      }

      setActiveWorkspace((currentWorkspace) => {
        if (currentWorkspace.status === "active") {
          return {
            ...currentWorkspace,
            projectSwitch: {
              status: "error",
              projectId,
              message: errorMessageFromUnknown(error),
            },
          };
        }

        return {
          status: "error",
          projectId,
          message: errorMessageFromUnknown(error),
        };
      });
    }
  }

  function handleProjectCreated(createdProject: CreatedProject) {
    projectSwitchSequenceRef.current += 1;
    setActiveWorkspace({
      status: "active",
      projectSwitch: { status: "idle" },
      project: createdProject.project,
      session: createdProject.defaultSession,
      panels: [],
    });
  }

  function handleProjectChanged(project: Project) {
    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status !== "active" || currentWorkspace.project.id !== project.id) {
        return currentWorkspace;
      }

      return { ...currentWorkspace, project };
    });
  }

  function handleProjectRemoved(projectId: string) {
    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status === "none") {
        return currentWorkspace;
      }

      const activeProjectId =
        currentWorkspace.status === "active"
          ? currentWorkspace.project.id
          : currentWorkspace.projectId;
      if (activeProjectId !== projectId) {
        return currentWorkspace;
      }

      return { status: "none" };
    });
  }

  function handlePanelCreated(panel: WorkspacePanel) {
    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status !== "active") {
        return currentWorkspace;
      }

      return { ...currentWorkspace, panels: [...currentWorkspace.panels, panel] };
    });
  }

  function handlePanelUpdated(panel: WorkspacePanel) {
    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status !== "active") {
        return currentWorkspace;
      }

      return {
        ...currentWorkspace,
        panels: currentWorkspace.panels.map((workspacePanel) =>
          workspacePanel.id === panel.id ? panel : workspacePanel,
        ),
      };
    });
  }

  async function handleSourceControlDiffOpen(entry: GitStatusEntry) {
    if (activeWorkspace.status !== "active") {
      return;
    }

    const panel = await openSourceControlDiffPanel({
      sessionId: activeWorkspace.session.id,
      title: fileTitle(entry.path),
      folderPath: activeWorkspace.project.folderPath,
      filePath: entry.path,
      oldPath: entry.oldPath,
      source: entry.area,
    });

    if (panel.kind !== "source_control_diff") {
      throw new Error(`Expected source control diff panel, received ${panel.kind}.`);
    }

    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status !== "active") {
        return currentWorkspace;
      }

      const existingPanel = currentWorkspace.panels.find(
        (workspacePanel) => workspacePanel.id === panel.id,
      );
      if (existingPanel !== undefined) {
        return currentWorkspace;
      }

      return { ...currentWorkspace, panels: [...currentWorkspace.panels, panel] };
    });

    const sequence = sourceControlDiffSequenceRef.current + 1;
    sourceControlDiffSequenceRef.current = sequence;
    setSourceControlDiffRequest({ sequence, panel });
  }

  async function handleExplorerFileOpen(filePath: string, lineNumber?: number) {
    if (activeWorkspace.status !== "active") {
      return;
    }

    try {
      const panel = await openFileEditorPanel({
        sessionId: activeWorkspace.session.id,
        title: fileTitle(filePath),
        folderPath: activeWorkspace.project.folderPath,
        filePath,
      });

      if (panel.kind !== "file_editor") {
        throw new Error(`Expected file editor panel, received ${panel.kind}.`);
      }

      setActiveWorkspace((currentWorkspace) => {
        if (currentWorkspace.status !== "active") {
          return currentWorkspace;
        }

        const existingPanel = currentWorkspace.panels.find(
          (workspacePanel) => workspacePanel.id === panel.id,
        );
        if (existingPanel !== undefined) {
          return currentWorkspace;
        }

        return { ...currentWorkspace, panels: [...currentWorkspace.panels, panel] };
      });

      const sequence = fileEditorSequenceRef.current + 1;
      fileEditorSequenceRef.current = sequence;
      setFileEditorRequest({
        sequence,
        panel,
        focusRequest: lineNumber === undefined ? undefined : { sequence, lineNumber, column: 1 },
      });
    } catch (error) {
      toast.error(`Failed to open ${filePath}: ${errorMessageFromUnknown(error)}`);
    }
  }

  function handleAgentThreadOpen(panelId: string) {
    const panel = requireActiveAgentThreadPanel(activeWorkspace, panelId);

    const sequence = agentThreadSequenceRef.current + 1;
    agentThreadSequenceRef.current = sequence;
    setAgentThreadRequest({ sequence, panel });
  }

  function handleAgentThreadClose(panelId: string) {
    requireActiveAgentThreadPanel(activeWorkspace, panelId);

    const sequence = agentThreadSequenceRef.current + 1;
    agentThreadSequenceRef.current = sequence;
    setAgentThreadOperationRequest({ sequence, panelId, operation: "close" });
  }

  async function handleAgentThreadDelete(panelId: string) {
    requireActiveAgentThreadPanel(activeWorkspace, panelId);

    try {
      await deleteWorkspacePanel({ panelId });
      const sequence = agentThreadSequenceRef.current + 1;
      agentThreadSequenceRef.current = sequence;
      setAgentThreadOperationRequest({ sequence, panelId, operation: "delete" });
      handlePanelDeleted(panelId);
    } catch (error) {
      toast.error(`Failed to delete Agent Thread: ${errorMessageFromUnknown(error)}`);
    }
  }

  async function handleAgentThreadRename(panelId: string, title: string) {
    requireActiveAgentThreadPanel(activeWorkspace, panelId);

    try {
      const panel = await renameWorkspacePanel({ panelId, title });
      if (panel.kind !== "agent_thread") {
        throw new Error(`Expected renamed Agent Thread panel, received ${panel.kind}.`);
      }

      setActiveWorkspace((currentWorkspace) => {
        if (currentWorkspace.status !== "active") {
          return currentWorkspace;
        }

        return {
          ...currentWorkspace,
          panels: currentWorkspace.panels.map((workspacePanel) =>
            workspacePanel.id === panel.id ? panel : workspacePanel,
          ),
        };
      });

      const sequence = agentThreadSequenceRef.current + 1;
      agentThreadSequenceRef.current = sequence;
      setAgentThreadOperationRequest({
        sequence,
        panelId,
        operation: "rename",
        title: panel.title,
      });
    } catch (error) {
      toast.error(`Failed to rename Agent Thread: ${errorMessageFromUnknown(error)}`);
      throw error;
    }
  }

  function handlePanelDeleted(panelId: string) {
    setSourceControlDiffRequest((currentRequest) => {
      if (currentRequest === undefined) {
        return currentRequest;
      }

      return currentRequest.panel.id === panelId ? void 0 : currentRequest;
    });
    setFileEditorRequest((currentRequest) => {
      if (currentRequest === undefined) {
        return currentRequest;
      }

      return currentRequest.panel.id === panelId ? void 0 : currentRequest;
    });
    setAgentThreadRequest((currentRequest) => {
      if (currentRequest === undefined) {
        return currentRequest;
      }

      return currentRequest.panel.id === panelId ? void 0 : currentRequest;
    });

    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status !== "active") {
        return currentWorkspace;
      }

      return {
        ...currentWorkspace,
        panels: currentWorkspace.panels.filter((panel) => panel.id !== panelId),
      };
    });
  }

  function handleSettingsOpen() {
    if (settingsSurfaceState !== "closed") {
      return;
    }

    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setSettingsSurfaceState("opening");
  }

  function handleSettingsEntered() {
    setSettingsSurfaceState((currentState) => (currentState === "opening" ? "open" : currentState));
  }

  function handleSettingsClose() {
    setSettingsSurfaceState((currentState) =>
      currentState === "closed" || currentState === "closing" ? currentState : "closing",
    );
  }

  function handleSettingsClosed() {
    setSettingsSurfaceState("closed");
    if (settingsReturnFocusRef.current !== undefined) {
      settingsReturnFocusRef.current.focus();
    }
    settingsReturnFocusRef.current = undefined;
  }

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_1.75rem] overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 border-b border-border">
        <ResizablePanel
          className="min-h-0"
          defaultSize="16rem"
          minSize="12rem"
          maxSize="24rem"
          groupResizeBehavior="preserve-pixel-size"
        >
          <AppSidebar
            activeWorkspace={activeWorkspace}
            onProjectChanged={handleProjectChanged}
            onProjectCreated={handleProjectCreated}
            onProjectRemoved={handleProjectRemoved}
            onProjectSelect={(projectId) => void handleProjectSelect(projectId)}
            onSessionSelect={(projectId, sessionId) =>
              void handleSessionSelect(projectId, sessionId)
            }
            onSettingsOpen={handleSettingsOpen}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="min-h-0 min-w-0 overflow-hidden" minSize="24rem">
          <AppWorkspace
            activeWorkspace={activeWorkspace}
            sourceControlDiffRequest={sourceControlDiffRequest}
            fileEditorRequest={fileEditorRequest}
            agentThreadRequest={agentThreadRequest}
            agentThreadOperationRequest={agentThreadOperationRequest}
            onPanelCreated={handlePanelCreated}
            onPanelUpdated={handlePanelUpdated}
            onPanelDeleted={handlePanelDeleted}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          className="min-h-0"
          defaultSize="18rem"
          minSize="14rem"
          maxSize="28rem"
          groupResizeBehavior="preserve-pixel-size"
        >
          <AppInspector
            activeWorkspace={activeWorkspace}
            onAgentThreadClose={handleAgentThreadClose}
            onAgentThreadDelete={handleAgentThreadDelete}
            onAgentThreadOpen={handleAgentThreadOpen}
            onAgentThreadRename={handleAgentThreadRename}
            onExplorerFileOpen={handleExplorerFileOpen}
            onSourceControlDiffOpen={handleSourceControlDiffOpen}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <AppStatusBar activeWorkspace={activeWorkspace} />
      {settingsSurfaceState === "closed" ? undefined : (
        <SettingsPage
          state={settingsSurfaceState}
          onClose={handleSettingsClose}
          onClosed={handleSettingsClosed}
          onEntered={handleSettingsEntered}
        />
      )}
    </div>
  );
}

function requireActiveAgentThreadPanel(activeWorkspace: ActiveWorkspaceState, panelId: string) {
  if (activeWorkspace.status !== "active") {
    throw new Error("An active Workspace is required before Agent Thread operations can run.");
  }

  const panel = activeWorkspace.panels.find((workspacePanel) => workspacePanel.id === panelId);
  if (panel === undefined || panel.kind !== "agent_thread") {
    throw new Error(`Expected Agent Thread panel ${panelId}.`);
  }

  return panel;
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to open project.";
}

export { AppShell };
