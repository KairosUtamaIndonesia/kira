import { useEffect, useRef, useState } from "react";

import type { CreatedProject, Project, WorkspacePanel } from "@/features/projects/types";
import type { GitStatusEntry } from "@/features/source-control/types";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { toast } from "@/components/ui/sonner";
import { startAgentRuntime } from "@/features/agent-thread/api/agentRuntimeApi";
import {
  openFileEditorPanel,
  openLastProject,
  openProject,
  openSourceControlDiffPanel,
} from "@/features/projects/api/projectsApi";
import { SettingsPage } from "@/features/settings";

import type {
  ActiveWorkspaceState,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
} from "../types";

import { AppInspector } from "./AppInspector";
import { AppSidebar } from "./AppSidebar";
import { AppStatusBar } from "./AppStatusBar";
import { AppWorkspace } from "./AppWorkspace";
import { useDevThemeToggle } from "./useDevThemeToggle";

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
  useDevThemeToggle();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspaceState>({ status: "none" });
  const [sourceControlDiffRequest, setSourceControlDiffRequest] =
    useState<SourceControlDiffOpenRequest>();
  const [fileEditorRequest, setFileEditorRequest] = useState<FileEditorOpenRequest>();
  const [settingsSurfaceState, setSettingsSurfaceState] = useState<SettingsSurfaceState>("closed");
  const projectSwitchSequenceRef = useRef(0);
  const sourceControlDiffSequenceRef = useRef(0);
  const fileEditorSequenceRef = useRef(0);
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
    let shouldOpenProject = true;
    const switchSequence = projectSwitchSequenceRef.current + 1;

    setActiveWorkspace((currentWorkspace) => {
      if (currentWorkspace.status === "active") {
        if (currentWorkspace.project.id === projectId) {
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
      const openedProject = await openProject({ projectId });
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

  async function handleExplorerFileOpen(filePath: string) {
    if (activeWorkspace.status !== "active") {
      return;
    }

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
    setFileEditorRequest({ sequence, panel });
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
            onSettingsOpen={handleSettingsOpen}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="min-h-0" minSize="24rem">
          <AppWorkspace
            activeWorkspace={activeWorkspace}
            sourceControlDiffRequest={sourceControlDiffRequest}
            fileEditorRequest={fileEditorRequest}
            onPanelCreated={handlePanelCreated}
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
