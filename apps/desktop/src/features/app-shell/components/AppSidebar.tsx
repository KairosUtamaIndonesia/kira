import { Settings } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreatedProject, Project } from "@/features/projects/types";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listProjectSessions, listProjects } from "@/features/projects/api/projectsApi";
import { NewProjectButton } from "@/features/projects/components/NewProjectButton";
import { ProjectList, type ProjectSessionsState } from "@/features/projects/components/ProjectList";

import type { ActiveWorkspaceState } from "../types";

import { useTitleBarDrag } from "./useTitleBarDrag";

type AppSidebarProps = {
  activeWorkspace: ActiveWorkspaceState;
  onProjectChanged: (project: Project) => void;
  onProjectCreated: (createdProject: CreatedProject) => void;
  onProjectRemoved: (projectId: string) => void;
  onProjectSelect: (projectId: string) => void;
  onSessionSelect: (projectId: string, sessionId: string) => void;
  onSettingsOpen: () => void;
};

function AppSidebar({
  activeWorkspace,
  onProjectChanged,
  onProjectCreated,
  onProjectRemoved,
  onProjectSelect,
  onSessionSelect,
  onSettingsOpen,
}: AppSidebarProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSessions, setProjectSessions] = useState<Record<string, ProjectSessionsState>>({});
  const [projectsError, setProjectsError] = useState<string>();

  useEffect(() => {
    let ignoreResult = false;

    async function loadProjects() {
      try {
        const loadedProjects = await listProjects();
        if (!ignoreResult) {
          setProjects(loadedProjects);
          setProjectSessions(loadingSessionsState(loadedProjects));
          setProjectsError(undefined);
        }

        await Promise.all(
          loadedProjects.map(async (project) => {
            try {
              const sessions = await listProjectSessions({ projectId: project.id });
              if (!ignoreResult) {
                setProjectSessions((currentProjectSessions) => ({
                  ...currentProjectSessions,
                  [project.id]: { status: "ready", sessions },
                }));
              }
            } catch (error) {
              if (!ignoreResult) {
                setProjectSessions((currentProjectSessions) => ({
                  ...currentProjectSessions,
                  [project.id]: {
                    status: "error",
                    sessions: [],
                    message: errorMessageFromUnknown(error),
                  },
                }));
              }
            }
          }),
        );
      } catch (error) {
        if (!ignoreResult) {
          setProjectsError(errorMessageFromUnknown(error));
        }
      }
    }

    void loadProjects();

    return () => {
      ignoreResult = true;
    };
  }, []);

  return (
    <SidebarProvider className="h-full min-h-0 text-sm">
      <Sidebar collapsible="none" className="w-full">
        <SidebarHeader
          role="toolbar"
          aria-label="Sidebar title bar"
          tabIndex={-1}
          className="h-11 justify-center border-b border-sidebar-border px-3 py-0 select-none"
          onDoubleClick={(event) => {
            void handleTitleBarDoubleClick(event);
          }}
          onMouseDown={(event) => {
            void handleTitleBarMouseDown(event);
          }}
        >
          <span className="font-semibold tracking-tight">Kira</span>
          {titleBarError === undefined ? undefined : (
            <output className="sr-only">{titleBarError}</output>
          )}
        </SidebarHeader>
        <SidebarContent className="scrollbar-sleek">
          <SidebarGroup aria-label="Projects">
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <NewProjectButton
              onProjectCreated={(createdProject) => {
                setProjects((currentProjects) =>
                  sortProjectsByName([...currentProjects, createdProject.project]),
                );
                setProjectSessions((currentProjectSessions) => ({
                  ...currentProjectSessions,
                  [createdProject.project.id]: {
                    status: "ready",
                    sessions: [createdProject.defaultSession],
                  },
                }));
                onProjectCreated(createdProject);
              }}
            />
            <SidebarGroupContent>
              {projectsError === undefined ? (
                <ProjectList
                  activeProjectId={activeProjectId(activeWorkspace)}
                  activeSessionId={activeSessionId(activeWorkspace)}
                  projects={projects}
                  projectSessions={projectSessions}
                  isProjectSwitching={isProjectSwitching(activeWorkspace)}
                  onProjectChanged={(project) => {
                    setProjects((currentProjects) =>
                      sortProjectsByName(
                        currentProjects.map((currentProject) =>
                          currentProject.id === project.id ? project : currentProject,
                        ),
                      ),
                    );
                    onProjectChanged(project);
                  }}
                  onProjectRemoved={(projectId) => {
                    setProjects((currentProjects) =>
                      currentProjects.filter((project) => project.id !== projectId),
                    );
                    setProjectSessions((currentProjectSessions) =>
                      omitProjectSessions(currentProjectSessions, projectId),
                    );
                    onProjectRemoved(projectId);
                  }}
                  onProjectSelect={onProjectSelect}
                  onSessionSelect={onSessionSelect}
                />
              ) : (
                <p role="alert" className="px-2 text-sm text-destructive">
                  {projectsError}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Button type="button" variant="ghost" onClick={onSettingsOpen} />}
              >
                <Settings aria-hidden="true" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}

function activeProjectId(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "active") {
    return activeWorkspace.project.id;
  }

  if (activeWorkspace.status === "loading" || activeWorkspace.status === "error") {
    return activeWorkspace.projectId;
  }

  return "";
}

function activeSessionId(activeWorkspace: ActiveWorkspaceState) {
  if (activeWorkspace.status === "active") {
    return activeWorkspace.session.id;
  }

  return "";
}

function isProjectSwitching(activeWorkspace: ActiveWorkspaceState) {
  return (
    activeWorkspace.status === "active" && activeWorkspace.projectSwitch.status === "switching"
  );
}

function loadingSessionsState(projects: Project[]) {
  return Object.fromEntries(
    projects.map((project) => [project.id, { status: "loading", sessions: [] }]),
  ) satisfies Record<string, ProjectSessionsState>;
}

function omitProjectSessions(
  projectSessions: Record<string, ProjectSessionsState>,
  projectId: string,
) {
  const nextProjectSessions = { ...projectSessions };
  delete nextProjectSessions[projectId];
  return nextProjectSessions;
}

function sortProjectsByName(projects: Project[]) {
  const sortedProjects = [...projects];
  // oxlint-disable-next-line unicorn/no-array-sort -- TypeScript target does not include Array.prototype.toSorted.
  sortedProjects.sort((leftProject, rightProject) =>
    leftProject.name.localeCompare(rightProject.name),
  );
  return sortedProjects;
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load projects.";
}

export { AppSidebar };
