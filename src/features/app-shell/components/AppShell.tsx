import { useEffect, useState } from "react";

import type { CreatedProject } from "@/features/projects/types";

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

  useEffect(() => {
    let ignoreResult = false;

    async function restoreLastProject() {
      try {
        const lastProject = await openLastProject();
        if (ignoreResult || lastProject === null) {
          return;
        }

        setActiveWorkspace({ status: "active", ...lastProject });
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
    setActiveWorkspace({ status: "loading", projectId });

    try {
      const openedProject = await openProject({ projectId });
      setActiveWorkspace({ status: "active", ...openedProject });
    } catch (error) {
      setActiveWorkspace({
        status: "error",
        projectId,
        message: errorMessageFromUnknown(error),
      });
    }
  }

  function handleProjectCreated(createdProject: CreatedProject) {
    setActiveWorkspace({
      status: "active",
      project: createdProject.project,
      session: createdProject.defaultSession,
      panels: [],
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
            onProjectCreated={handleProjectCreated}
            onProjectSelect={(projectId) => void handleProjectSelect(projectId)}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="min-h-0" minSize="24rem">
          <AppWorkspace activeWorkspace={activeWorkspace} />
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
