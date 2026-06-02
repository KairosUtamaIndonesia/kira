import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { CreatedProject } from "../types";

import { createProject } from "../api/projectsApi";

type NewProjectDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: (createdProject: CreatedProject) => void;
};

function NewProjectDialog({ isOpen, onOpenChange, onProjectCreated }: NewProjectDialogProps) {
  const folderPathInputId = useId();
  const projectNameInputId = useId();
  const [folderPath, setFolderPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectNameTouched, setProjectNameTouched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);

  const canCreate = folderPath.trim().length > 0 && projectName.trim().length > 0 && !isCreating;

  function handleOpenChange(nextOpen: boolean) {
    if (isCreating) {
      return;
    }

    if (!nextOpen) {
      resetDialogState();
    }
    onOpenChange(nextOpen);
  }

  async function handleBrowseFolder() {
    const selectedPath = await openFolderPicker({ directory: true, multiple: false });
    if (selectedPath === null) {
      return;
    }

    setFolderPath(selectedPath);
    setErrorMessage(undefined);

    if (!projectNameTouched) {
      setProjectName(projectNameFromPath(selectedPath));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    setIsCreating(true);
    setErrorMessage(undefined);

    try {
      const createdProject = await createProject({
        folderPath: folderPath.trim(),
        name: projectName.trim(),
      });
      onProjectCreated(createdProject);
      resetDialogState();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(errorMessageFromUnknown(error));
    } finally {
      setIsCreating(false);
    }
  }

  function resetDialogState() {
    setFolderPath("");
    setProjectName("");
    setProjectNameTouched(false);
    setErrorMessage(undefined);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>Add a local folder or repository to Kira.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <Label htmlFor={folderPathInputId}>Local folder</Label>
            <div className="flex gap-2">
              <Input
                id={folderPathInputId}
                value={folderPath}
                readOnly
                placeholder="Select a local folder"
                className="min-w-0 flex-1"
              />
              <Button type="button" variant="outline" onClick={() => void handleBrowseFolder()}>
                Browse
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={projectNameInputId}>Project name</Label>
            <Input
              id={projectNameInputId}
              value={projectName}
              onChange={(event) => {
                setProjectName(event.target.value);
                setProjectNameTouched(true);
                setErrorMessage(undefined);
              }}
              placeholder="Project name"
            />
          </div>
          <p className="text-sm text-muted-foreground">A default session will be created.</p>
          {errorMessage === undefined ? undefined : (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isCreating} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!canCreate}>
              {isCreating ? "Adding…" : "Add Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function projectNameFromPath(path: string) {
  const pathParts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart === undefined) {
    return path;
  }

  return lastPart;
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to add project.";
}

export { NewProjectDialog };
