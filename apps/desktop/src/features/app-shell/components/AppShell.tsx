import { useEffect, useRef, useState } from "react";

import type { CreatedProject, Project, WorkspacePanel } from "@/features/projects/types";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { openLastProject, openProject } from "@/features/projects/api/projectsApi";

import type { ActiveWorkspaceState } from "../types";

import { AppInspector } from "./AppInspector";
import { AppSidebar } from "./AppSidebar";
import { AppStatusBar } from "./AppStatusBar";
import { AppWorkspace } from "./AppWorkspace";
import { useDevThemeToggle } from "./useDevThemeToggle";

function AppShell() {
  useDevThemeToggle();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspaceState>({ status: "none" });
  const projectSwitchSequenceRef = useRef(0);

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

  function handlePanelDeleted(panelId: string) {
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
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="min-h-0" minSize="24rem">
          <AppWorkspace
            activeWorkspace={activeWorkspace}
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
          <AppInspector activeWorkspace={activeWorkspace} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <AppStatusBar activeWorkspace={activeWorkspace} />
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
