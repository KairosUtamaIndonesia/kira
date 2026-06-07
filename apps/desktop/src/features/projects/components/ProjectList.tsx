import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronRight, Copy, ExternalLink, Folder, Pencil, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

import type { Project, Session } from "../types";

import { removeProject, renameProject } from "../api/projectsApi";

type ProjectSessionsState = {
  sessions: Session[];
  status: "loading" | "ready" | "error";
  message?: string;
};

type ProjectBranchState = {
  branchLabel: string;
};

type ProjectListProps = {
  activeProjectId: string;
  activeSessionId: string;
  projects: Project[];
  projectSessions: Record<string, ProjectSessionsState>;
  projectBranches: Record<string, ProjectBranchState>;
  isProjectSwitching: boolean;
  onProjectChanged: (project: Project) => void;
  onProjectRemoved: (projectId: string) => void;
  onProjectSelect: (projectId: string) => void;
  onSessionSelect: (projectId: string, sessionId: string) => void;
};

function ProjectList({
  activeProjectId,
  activeSessionId,
  projects,
  projectSessions,
  projectBranches,
  isProjectSwitching,
  onProjectChanged,
  onProjectRemoved,
  onProjectSelect,
  onSessionSelect,
}: ProjectListProps) {
  const [projectToRename, setProjectToRename] = useState<Project>();
  const [projectToRemove, setProjectToRemove] = useState<Project>();
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);

  function handleProjectCollapseToggle(projectId: string) {
    setCollapsedProjectIds((currentProjectIds) =>
      toggleProjectCollapse(currentProjectIds, projectId),
    );
  }

  if (projects.length === 0) {
    return <p className="px-2 text-sm text-sidebar-foreground/60">No projects yet</p>;
  }

  return (
    <>
      <SidebarMenu aria-label="Projects">
        {projects.map((project) => {
          const isProjectCollapsed = collapsedProjectIds.includes(project.id);

          return (
            <SidebarMenuItem key={project.id}>
              <ContextMenu>
                <ContextMenuTrigger render={<div />}>
                  <SidebarMenuButton
                    className="pr-8 font-medium"
                    isActive={project.id === activeProjectId}
                    render={
                      <button
                        type="button"
                        aria-label={project.name}
                        disabled={isProjectSwitching}
                        onClick={() => onProjectSelect(project.id)}
                      />
                    }
                  >
                    <Folder aria-hidden="true" />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={
                          isProjectCollapsed ? `Expand ${project.name}` : `Collapse ${project.name}`
                        }
                        aria-expanded={!isProjectCollapsed}
                        onClick={() => handleProjectCollapseToggle(project.id)}
                      />
                    }
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={
                        isProjectCollapsed
                          ? "transition-transform duration-150"
                          : "rotate-90 transition-transform duration-150"
                      }
                    />
                  </SidebarMenuAction>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setProjectToRename(project)}>
                    <Pencil aria-hidden="true" />
                    <span>Rename</span>
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void revealProjectFolder(project)}>
                    <ExternalLink aria-hidden="true" />
                    <span>Reveal Folder</span>
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void copyProjectPath(project)}>
                    <Copy aria-hidden="true" />
                    <span>Copy Path</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => setProjectToRemove(project)}
                  >
                    <Trash aria-hidden="true" />
                    <span>Remove from Kira</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <ProjectSessions
                activeSessionId={project.id === activeProjectId ? activeSessionId : ""}
                isCollapsed={isProjectCollapsed}
                isProjectSwitching={isProjectSwitching}
                project={project}
                branchLabel={branchLabelForProject(projectBranches, project.id)}
                sessionsState={projectSessions[project.id]}
                onSessionSelect={onSessionSelect}
              />
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <RenameProjectDialog
        project={projectToRename}
        onOpenChange={(open) => {
          if (!open) {
            setProjectToRename(undefined);
          }
        }}
        onProjectChanged={onProjectChanged}
      />
      <RemoveProjectDialog
        project={projectToRemove}
        onOpenChange={(open) => {
          if (!open) {
            setProjectToRemove(undefined);
          }
        }}
        onProjectRemoved={onProjectRemoved}
      />
    </>
  );
}

type ProjectSessionsProps = {
  activeSessionId: string;
  isCollapsed: boolean;
  isProjectSwitching: boolean;
  project: Project;
  branchLabel: string | undefined;
  sessionsState: ProjectSessionsState | undefined;
  onSessionSelect: (projectId: string, sessionId: string) => void;
};

function ProjectSessions({
  activeSessionId,
  isCollapsed,
  isProjectSwitching,
  project,
  branchLabel,
  sessionsState,
  onSessionSelect,
}: ProjectSessionsProps) {
  if (sessionsState === undefined || sessionsState.status === "loading") {
    return <p className="px-9 py-1 text-xs text-sidebar-foreground/60">Loading Sessions…</p>;
  }

  if (sessionsState.status === "error") {
    return (
      <p role="alert" className="px-9 py-1 text-xs text-destructive">
        {sessionsState.message}
      </p>
    );
  }

  if (sessionsState.sessions.length === 0) {
    return <p className="px-9 py-1 text-xs text-destructive">Project has no Sessions.</p>;
  }

  return (
    <div
      aria-hidden={isCollapsed}
      className={
        isCollapsed
          ? "grid grid-rows-[0fr] overflow-hidden opacity-0 transition-all duration-150 ease-out"
          : "grid grid-rows-[1fr] overflow-hidden opacity-100 transition-all duration-150 ease-out motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
      }
    >
      <SidebarMenuSub
        aria-label={`${project.name} Sessions`}
        className="mx-0 mt-1 min-h-0 gap-1.5 overflow-hidden border-l-0 px-0"
      >
        {sessionsState.sessions.map((session) => (
          <SidebarMenuSubItem
            key={session.id}
            className="relative pl-5 before:absolute before:top-0 before:left-2 before:h-5 before:w-3 before:rounded-bl-md before:border-b before:border-l before:border-sidebar-border before:content-['']"
          >
            <SidebarMenuSubButton
              className="h-auto w-full items-start justify-start py-2 text-left"
              isActive={session.id === activeSessionId}
              render={
                <button
                  type="button"
                  aria-label={`${project.name} Session ${session.name}`}
                  disabled={isProjectSwitching}
                  onClick={() => onSessionSelect(project.id, session.id)}
                />
              }
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{session.name}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">project folder</span>
                <span className="truncate text-xs text-sidebar-foreground/60">
                  {branchLabel ?? "Branch unavailable"}
                </span>
              </span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </div>
  );
}

function toggleProjectCollapse(collapsedProjectIds: string[], projectId: string) {
  if (collapsedProjectIds.includes(projectId)) {
    return collapsedProjectIds.filter((collapsedProjectId) => collapsedProjectId !== projectId);
  }

  return [...collapsedProjectIds, projectId];
}

function branchLabelForProject(
  projectBranches: Record<string, ProjectBranchState>,
  projectId: string,
) {
  const projectBranch = projectBranches[projectId];
  if (projectBranch === undefined) {
    return void 0;
  }

  return projectBranch.branchLabel;
}

type RenameProjectDialogProps = {
  project: Project | undefined;
  onOpenChange: (open: boolean) => void;
  onProjectChanged: (project: Project) => void;
};

function RenameProjectDialog({
  project,
  onOpenChange,
  onProjectChanged,
}: RenameProjectDialogProps) {
  const [name, setName] = useState("");
  const open = project !== undefined;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && project !== undefined) {
      setName(project.name);
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (project === undefined) {
      return;
    }

    try {
      const renamedProject = await renameProject({ projectId: project.id, name });
      onProjectChanged(renamedProject);
      toast.success("Project renamed");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessageFromUnknown(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Project</DialogTitle>
          <DialogDescription>Update the Project name shown in Kira.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="rename-project-name">Project name</Label>
            <Input
              id="rename-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Rename Project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RemoveProjectDialogProps = {
  project: Project | undefined;
  onOpenChange: (open: boolean) => void;
  onProjectRemoved: (projectId: string) => void;
};

function RemoveProjectDialog({
  project,
  onOpenChange,
  onProjectRemoved,
}: RemoveProjectDialogProps) {
  async function handleRemoveProject() {
    if (project === undefined) {
      return;
    }

    try {
      await removeProject({ projectId: project.id });
      onProjectRemoved(project.id);
      toast.success("Project removed from Kira");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessageFromUnknown(error));
    }
  }

  return (
    <AlertDialog open={project !== undefined} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Project?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {projectName(project)} from Kira. The local folder is not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void handleRemoveProject()}>
            Remove from Kira
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function projectName(project: Project | undefined) {
  if (project === undefined) {
    return "this Project";
  }

  return project.name;
}

async function revealProjectFolder(project: Project) {
  try {
    await revealItemInDir(project.folderPath);
  } catch (error) {
    toast.error(errorMessageFromUnknown(error));
  }
}

async function copyProjectPath(project: Project) {
  try {
    await navigator.clipboard.writeText(project.folderPath);
    toast.success("Project path copied");
  } catch (error) {
    toast.error(errorMessageFromUnknown(error));
  }
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Project action failed.";
}

export { ProjectList };
export type { ProjectBranchState, ProjectSessionsState };
