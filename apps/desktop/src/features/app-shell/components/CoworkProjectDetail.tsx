import type { Event, UnlistenFn } from "@tauri-apps/api/event";

import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowLeft, File, FolderOpen, Loader2, Pencil, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ExplorerEntry } from "@/features/explorer/types";
import type { AgentThreadPanelListing, Project } from "@/features/projects/types";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { readEditorFile, writeEditorFile } from "@/features/editor/api/editorApi";
import { getExplorerTree } from "@/features/explorer/api/explorerApi";
import {
  copyFilesToProject,
  listCoworkAgentThreadPanels,
  removeProject,
  renameProject,
} from "@/features/projects/api/projectsApi";

type CoworkProjectDetailProps = {
  project: Project;
  onBack: () => void;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
  onProjectRenamed: (project: Project) => void;
  onProjectRemoved: () => void;
};

function CoworkProjectDetail({
  project,
  onBack,
  onThreadSelect,
  onProjectRenamed,
  onProjectRemoved,
}: CoworkProjectDetailProps) {
  const [files, setFiles] = useState<ExplorerEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptExists, setPromptExists] = useState(false);
  const [threads, setThreads] = useState<AgentThreadPanelListing[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Load project files.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getExplorerTree({
          folderPath: project.folderPath,
        });
        if (!cancelled) {
          setFiles(result.entries.filter((entry) => entry.path !== "agents.md"));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`Failed to load project files: ${errorMessageFromUnknown(error)}`);
        }
      } finally {
        if (!cancelled) {
          setFilesLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [project.folderPath]);

  // Load agents.md prompt.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await readEditorFile({
          folderPath: project.folderPath,
          filePath: "agents.md",
        });
        if (!cancelled && result.kind === "text") {
          setPrompt(result.content);
          setPromptExists(true);
        }
      } catch {
        // File doesn't exist yet — prompt stays empty.
      } finally {
        if (!cancelled) {
          setPromptLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [project.folderPath]);

  // Load threads for this project.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const allThreads = await listCoworkAgentThreadPanels();
        if (!cancelled) {
          setThreads(allThreads.filter((t) => t.project.id === project.id));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`Failed to load threads: ${errorMessageFromUnknown(error)}`);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Tauri drag-drop: listen for OS-level file drops on the window.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    async function listen() {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event: Event<DragDropEvent>) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragOver(true);
          } else if (event.payload.type === "leave") {
            setIsDragOver(false);
          } else if (event.payload.type === "drop") {
            setIsDragOver(false);
            const paths = event.payload.paths;
            if (paths.length > 0) {
              void handleDropFiles(paths);
            }
          }
        });
      } catch {
        // Drag-drop not available — fall back to nothing.
      }
    }

    async function handleDropFiles(sourcePaths: string[]) {
      try {
        await copyFilesToProject({
          projectFolderPath: project.folderPath,
          sourcePaths,
        });
        toast.success(`${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} added`);
        // Refresh file list.
        const result = await getExplorerTree({
          folderPath: project.folderPath,
        });
        setFiles(result.entries.filter((entry) => entry.path !== "agents.md"));
      } catch (error) {
        toast.error(`Failed to add files: ${errorMessageFromUnknown(error)}`);
      }
    }

    void listen();
    return () => {
      if (unlisten !== undefined) {
        unlisten();
      }
    };
  }, [project.folderPath]);

  async function handleSavePrompt() {
    setPromptSaving(true);
    try {
      await writeEditorFile({
        folderPath: project.folderPath,
        filePath: "agents.md",
        content: prompt,
      });
      setPromptExists(true);
      toast.success("Custom prompt saved");
    } catch (error) {
      toast.error(`Failed to save prompt: ${errorMessageFromUnknown(error)}`);
    } finally {
      setPromptSaving(false);
    }
  }

  async function handleRename() {
    setIsRenaming(true);
    try {
      const renamed = await renameProject({
        projectId: project.id,
        name: renameName,
      });
      onProjectRenamed(renamed);
      toast.success("Project renamed");
      setRenameOpen(false);
    } catch (error) {
      toast.error(errorMessageFromUnknown(error));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await removeProject({ projectId: project.id });
      toast.success("Project removed from Kira");
      setRemoveOpen(false);
      onProjectRemoved();
    } catch (error) {
      toast.error(errorMessageFromUnknown(error));
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 text-lg font-semibold">{project.name}</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setRenameName(project.name);
            setRenameOpen(true);
          }}
          aria-label="Rename project"
        >
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setRemoveOpen(true)}
          aria-label="Remove project"
        >
          <Trash aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Files section */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <FolderOpen aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Files</h2>
          </div>
          <section
            aria-label="Drop zone for project files"
            className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30"
            }`}
          >
            {filesLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2
                  aria-hidden="true"
                  className="h-5 w-5 animate-spin text-muted-foreground"
                />
              </div>
            )}
            {!filesLoading && files.length === 0 && (
              <div className="py-8 text-center">
                <Upload aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Drop files here to add context for the agent
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Files are copied into the project folder
                </p>
              </div>
            )}
            {!filesLoading && files.length > 0 && (
              <ul className="space-y-1">
                {files.map((entry) => (
                  <li
                    key={entry.path}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
                  >
                    <File aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

        {/* Custom prompt section */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Pencil aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Custom Prompt</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Saved as <code className="rounded bg-muted px-1 py-0.5 font-mono">agents.md</code> in
            the project folder. The agent runtime loads this automatically.
          </p>
          {promptLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                ref={promptRef}
                aria-label="Custom prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Enter custom instructions for the agent…"
                className="min-h-[120px] w-full rounded-lg border border-border bg-editor-surface p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary focus:outline-none"
              />
              {!promptExists && prompt.length === 0 && (
                <p className="text-xs text-muted-foreground/60">
                  No custom prompt set. Write one and save to create{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">agents.md</code>.
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={promptSaving}
                  onClick={() => void handleSavePrompt()}
                >
                  {promptSaving ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save Prompt"
                  )}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Threads section */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Conversations</h2>
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conversations in this project yet.</p>
          ) : (
            <ul className="space-y-1">
              {threads.map((listing) => (
                <li key={listing.panel.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => onThreadSelect(listing)}
                  >
                    {listing.panel.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>Update the project name shown in Kira.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRename();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="project-detail-rename">Project name</Label>
              <Input
                id="project-detail-rename"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isRenaming}>
                {isRenaming ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  "Rename Project"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove dialog */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Project?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {project.name} from Kira. The local folder is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleRemove()}>
              {isRemoving ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                "Remove from Kira"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

  return "An unexpected error occurred.";
}

export { CoworkProjectDetail };
