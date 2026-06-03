import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, Folder, Pencil, Trash } from "lucide-react";
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

import type { Project } from "../types";

import { removeProject, renameProject } from "../api/projectsApi";

type ProjectListProps = {
  activeProjectId: string;
  projects: Project[];
  isProjectSwitching: boolean;
  onProjectChanged: (project: Project) => void;
  onProjectRemoved: (projectId: string) => void;
  onProjectSelect: (projectId: string) => void;
};

function ProjectList({
  activeProjectId,
  projects,
  isProjectSwitching,
  onProjectChanged,
  onProjectRemoved,
  onProjectSelect,
}: ProjectListProps) {
  const [projectToRename, setProjectToRename] = useState<Project>();
  const [projectToRemove, setProjectToRemove] = useState<Project>();

  if (projects.length === 0) {
    return <p className="px-2 text-sm text-sidebar-foreground/60">No projects yet</p>;
  }

  return (
    <>
      <SidebarMenu aria-label="Projects">
        {projects.map((project) => (
          <SidebarMenuItem key={project.id}>
            <ContextMenu>
              <ContextMenuTrigger render={<div />}>
                <SidebarMenuButton
                  className="font-medium"
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
                <ContextMenuItem variant="destructive" onClick={() => setProjectToRemove(project)}>
                  <Trash aria-hidden="true" />
                  <span>Remove from Kira</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </SidebarMenuItem>
        ))}
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
