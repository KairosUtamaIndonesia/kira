import type { Event, UnlistenFn } from "@tauri-apps/api/event";

import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ChevronRight,
  File,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash,
  Upload,
  X,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { Composer } from "@/features/agent-thread/components/Composer";
import { deleteEditorFile, readEditorFile, writeEditorFile } from "@/features/editor/api/editorApi";
import { getExplorerTree } from "@/features/explorer/api/explorerApi";
import {
  copyFilesToProject,
  listCoworkAgentThreadPanels,
  removeProject,
  renameProject,
} from "@/features/projects/api/projectsApi";

import {
  AgentThreadRow,
  DeleteAgentThreadDialog,
  RenameAgentThreadDialog,
} from "../shared/AgentThreadRow";
type CoworkProjectDetailProps = {
  project: Project;
  onBack: () => void;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => Promise<void>;
  onThreadRename: (listing: AgentThreadPanelListing, title: string) => Promise<void>;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
  onNewConversation: (project: Project, prompt?: string) => void;
  onProjectRenamed: (project: Project) => void;
  onProjectRemoved: () => void;
};

// ─── Component ──────────────────────────────────────────────────────────────

function CoworkProjectDetail({
  project,
  onBack,
  onThreadClose,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
  onNewConversation,
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
  const [filesExpanded, setFilesExpanded] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [addTextOpen, setAddTextOpen] = useState(false);
  const [addTextTitle, setAddTextTitle] = useState("");
  const [addTextContent, setAddTextContent] = useState("");
  const [addTextSaving, setAddTextSaving] = useState(false);
  const [listingToRename, setListingToRename] = useState<AgentThreadPanelListing>();
  const [listingToDelete, setListingToDelete] = useState<AgentThreadPanelListing>();
  const [renameThreadTitle, setRenameThreadTitle] = useState("");
  const [renameThreadError, setRenameThreadError] = useState<string>();
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const renameThreadInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (listingToRename !== undefined) {
      if (renameThreadInputRef.current !== null) {
        renameThreadInputRef.current.focus();
      }
    }
  }, [listingToRename]);

  // Load project files.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getExplorerTree({ folderPath: project.folderPath });
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
        // Drag-drop unavailable.
      }
    }

    async function handleDropFiles(sourcePaths: string[]) {
      try {
        await copyFilesToProject({
          projectFolderPath: project.folderPath,
          sourcePaths,
        });
        toast.success(`${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} added`);
        const result = await getExplorerTree({ folderPath: project.folderPath });
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

  async function handleFilePicker() {
    const selected = await open({
      multiple: true,
      directory: false,
    });
    if (selected === null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    try {
      await copyFilesToProject({
        projectFolderPath: project.folderPath,
        sourcePaths: paths,
      });
      toast.success(`${paths.length} file${paths.length === 1 ? "" : "s"} added`);
      const result = await getExplorerTree({ folderPath: project.folderPath });
      setFiles(result.entries.filter((entry) => entry.path !== "agents.md"));
    } catch (error) {
      toast.error(`Failed to add files: ${errorMessageFromUnknown(error)}`);
    }
  }

  function handleDomDragOver(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDomDragLeave(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
  }

  function handleDomDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    // Native OS drops are handled by the Tauri onDragDropEvent listener above.
    // DOM drops only fire for in-web drags; nothing to do here for file uploads.
  }

  async function handleAddTextContent() {
    if (addTextTitle.trim().length === 0) return;
    setAddTextSaving(true);
    try {
      const slug = addTextTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const fileName = `${slug}.md`;
      await writeEditorFile({
        folderPath: project.folderPath,
        filePath: fileName,
        content: addTextContent,
      });
      toast.success(`Created ${fileName}`);
      setAddTextOpen(false);
      setAddTextTitle("");
      setAddTextContent("");
      const result = await getExplorerTree({ folderPath: project.folderPath });
      setFiles(result.entries.filter((entry) => entry.path !== "agents.md"));
    } catch (error) {
      toast.error(`Failed to create file: ${errorMessageFromUnknown(error)}`);
    } finally {
      setAddTextSaving(false);
    }
  }

  async function handleDeleteFile(filePath: string) {
    try {
      await deleteEditorFile({
        folderPath: project.folderPath,
        filePath,
      });
      toast.success(`Deleted ${filePath}`);
      const result = await getExplorerTree({ folderPath: project.folderPath });
      setFiles(result.entries.filter((entry) => entry.path !== "agents.md"));
    } catch (error) {
      toast.error(`Failed to delete file: ${errorMessageFromUnknown(error)}`);
    }
  }

  function openRenameThreadDialog(listing: AgentThreadPanelListing) {
    setListingToRename(listing);
    setRenameThreadTitle(listing.panel.title);
    setRenameThreadError(undefined);
  }

  async function handleRenameThread() {
    if (listingToRename === undefined) {
      throw new Error("An Agent Thread is required before it can be renamed.");
    }

    const title = renameThreadTitle.trim();
    if (title.length === 0) {
      setRenameThreadError("Agent Thread title is required.");
      return;
    }

    await onThreadRename(listingToRename, title);
    setListingToRename(undefined);
    setRenameThreadTitle("");
    setRenameThreadError(undefined);
  }

  async function handleDeleteThread() {
    if (listingToDelete === undefined) {
      throw new Error("An Agent Thread is required before it can be deleted.");
    }

    setIsDeletingThread(true);
    try {
      await onThreadDelete(listingToDelete);
      setListingToDelete(undefined);
    } finally {
      setIsDeletingThread(false);
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Composer + conversations ────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-border px-3 py-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">{project.name}</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-xl">
            <Composer
              threadId={`project-${project.id}`}
              folderPath={project.folderPath}
              placeholder="How can I help you today?"
              sendPrompt={async (promptText) => {
                onNewConversation(project, promptText);
                return true;
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Right: Project metadata sidebar ──────────────────────────── */}
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-sidebar">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{project.name}</h2>
          <div className="flex items-center gap-1">
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
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setRemoveOpen(true)}
              aria-label="Remove project"
            >
              <Trash aria-hidden="true" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Memory / Purpose & Context */}
          <SidebarSection title="Purpose & Context" defaultExpanded>
            {promptLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin text-muted-foreground"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  ref={promptRef}
                  aria-label="Purpose and context"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe the purpose and context of this project…"
                  className="min-h-[80px] w-full resize-none rounded-md border border-border bg-editor-surface p-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary focus:outline-none"
                />
                {!promptExists && prompt.length === 0 && (
                  <p className="text-xs text-muted-foreground/60">
                    Saved as{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">agents.md</code>.
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={promptSaving}
                    onClick={() => void handleSavePrompt()}
                  >
                    {promptSaving ? (
                      <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SidebarSection>

          {/* Threads */}
          <SidebarSection title="Threads" defaultExpanded>
            {threads.length === 0 ? (
              <p className="text-xs text-muted-foreground">No conversations yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {threads.map((listing) => (
                  <li key={listing.panel.id}>
                    <AgentThreadRow
                      panel={listing.panel}
                      onClose={() => onThreadClose(listing)}
                      onDelete={() => setListingToDelete(listing)}
                      onOpen={() => onThreadSelect(listing)}
                      onRename={() => openRenameThreadDialog(listing)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </SidebarSection>

          {/* Files */}
          <SidebarSection
            title="Files"
            expanded={filesExpanded}
            onToggle={() => setFilesExpanded((v) => !v)}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Add files"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void handleFilePicker()}>
                    <Paperclip aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                    Upload from device
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setAddTextTitle("");
                      setAddTextContent("");
                      setAddTextOpen(true);
                    }}
                  >
                    <FileText aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                    Add text content
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          >
            <div
              onDragOver={handleDomDragOver}
              onDragLeave={handleDomDragLeave}
              onDrop={handleDomDrop}
              className={`rounded-lg transition-colors ${
                isDragOver ? "bg-primary/5 ring-1 ring-primary" : ""
              }`}
            >
              {filesLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin text-muted-foreground"
                  />
                </div>
              )}
              {!filesLoading && files.length === 0 && (
                <button
                  type="button"
                  className="flex w-full flex-col items-center rounded-lg border-2 border-dashed p-3 transition-colors hover:border-muted-foreground/30"
                  onClick={() => void handleFilePicker()}
                >
                  <Upload aria-hidden="true" className="h-6 w-6 text-muted-foreground/50" />
                  <p className="mt-1.5 text-xs text-muted-foreground">Add PDFs, documents, etc</p>
                </button>
              )}
              {!filesLoading && files.length > 0 && (
                <ul className="space-y-0.5">
                  {files.map((entry) => (
                    <li
                      key={entry.path}
                      className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/50"
                    >
                      <File
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1 truncate">{entry.path}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Delete ${entry.path}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteFile(entry.path);
                        }}
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SidebarSection>
        </div>
      </aside>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}
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

      <Dialog
        open={addTextOpen}
        onOpenChange={(isOpen) => {
          setAddTextOpen(isOpen);
          if (!isOpen) {
            setAddTextTitle("");
            setAddTextContent("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Text Content</DialogTitle>
            <DialogDescription>
              Create a markdown file in the project. Saved as{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                {addTextTitle.trim().length > 0
                  ? `${addTextTitle
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")}.md`
                  : "…"}
              </code>
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddTextContent();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="add-text-title">Title</Label>
              <Input
                id="add-text-title"
                value={addTextTitle}
                onChange={(event) => setAddTextTitle(event.target.value)}
                placeholder="e.g. Project Brief"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-text-content">Content</Label>
              <Textarea
                id="add-text-content"
                value={addTextContent}
                onChange={(event) => setAddTextContent(event.target.value)}
                placeholder="Write your content here…"
                className="min-h-[120px]"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddTextOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addTextSaving || addTextTitle.trim().length === 0}>
                {addTextSaving ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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

      <RenameAgentThreadDialog
        error={renameThreadError}
        inputRef={renameThreadInputRef}
        open={listingToRename !== undefined}
        title={renameThreadTitle}
        onOpenChange={(isOpen) => !isOpen && setListingToRename(undefined)}
        onSubmit={() => void handleRenameThread()}
        onTitleChange={(title) => {
          setRenameThreadTitle(title);
          setRenameThreadError(undefined);
        }}
      />
      <DeleteAgentThreadDialog
        open={listingToDelete !== undefined}
        isDeleting={isDeletingThread}
        onOpenChange={(isOpen) => !isOpen && setListingToDelete(undefined)}
        onConfirm={() => void handleDeleteThread()}
      />
    </div>
  );
}

// ─── Sidebar section ────────────────────────────────────────────────────────

type SidebarSectionProps = {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

function SidebarSection({
  title,
  children,
  actions,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
}: SidebarSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = controlledExpanded ?? internalExpanded;

  function handleToggle() {
    if (onToggle !== undefined) {
      onToggle();
    } else {
      setInternalExpanded((v) => !v);
    }
  }

  return (
    <div className="border-b border-border">
      <div className="flex w-full items-center gap-1 px-4 py-2.5">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleToggle}
        >
          <ChevronRight
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          {title}
        </button>
        {actions}
      </div>
      {isExpanded && <div className="px-4 pb-3">{children}</div>}
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
