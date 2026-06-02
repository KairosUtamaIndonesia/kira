import { Settings } from "lucide-react";
import { useEffect, useState } from "react";

import type { Project } from "@/features/projects/types";

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
import { listProjects } from "@/features/projects/api/projectsApi";
import { NewProjectButton } from "@/features/projects/components/NewProjectButton";
import { ProjectList } from "@/features/projects/components/ProjectList";

import { useTitleBarDrag } from "./useTitleBarDrag";

function AppSidebar() {
  const { handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string>();

  useEffect(() => {
    let ignoreResult = false;

    async function loadProjects() {
      try {
        const loadedProjects = await listProjects();
        if (!ignoreResult) {
          setProjects(loadedProjects);
          setProjectsError(undefined);
        }
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
                setProjects((currentProjects) => [...currentProjects, createdProject.project]);
              }}
            />
            <SidebarGroupContent>
              {projectsError === undefined ? (
                <ProjectList projects={projects} />
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
              <SidebarMenuButton render={<Button type="button" variant="ghost" />}>
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
