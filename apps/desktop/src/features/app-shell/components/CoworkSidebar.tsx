import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

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
  Sidebar,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

import type { CoworkProjectWithThreads, CoworkProjectsState } from "../hooks/useCoworkProjects";
import type { CoworkThreadsState } from "../hooks/useCoworkThreads";

import { AgentThreadRow, DeleteAgentThreadDialog, RenameAgentThreadDialog } from "./AgentThreadRow";

// ─── Types ──────────────────────────────────────────────────────────────────

type CoworkSidebarProps = {
  threadsState: CoworkThreadsState;
  projectsState: CoworkProjectsState;
  isCreatingProject: boolean;
  activePanelId: string | undefined;
  isCreatingConversation: boolean;
  onNewConversation: () => void;
  onSettingsOpen: () => void;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => Promise<void>;
  onThreadRename: (listing: AgentThreadPanelListing, title: string) => Promise<void>;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
  onProjectSelect: (project: Project) => void;
  onProjectCreate: () => void;
  onProjectRename: (project: Project, name: string) => Promise<void>;
  onProjectRemove: (projectId: string) => Promise<void>;
};

function CoworkSidebar({
  threadsState,
  projectsState,
  isCreatingProject,
  activePanelId,
  isCreatingConversation,
  onNewConversation,
  onSettingsOpen,
  onThreadClose,
  onProjectCreate,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
  onProjectSelect,
  onProjectRename,
  onProjectRemove,
}: CoworkSidebarProps) {
  const [listingToRename, setListingToRename] = useState<AgentThreadPanelListing>();
  const [listingToDelete, setListingToDelete] = useState<AgentThreadPanelListing>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [projectToRename, setProjectToRename] = useState<Project>();
  const [projectToRemove, setProjectToRemove] = useState<Project>();
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (listingToRename !== undefined) {
      if (renameInputRef.current !== null) {
        renameInputRef.current.focus();
      }
    }
  }, [listingToRename]);

  function openRenameDialog(listing: AgentThreadPanelListing) {
    setListingToRename(listing);
    setRenameTitle(listing.panel.title);
    setRenameError(undefined);
  }

  async function renameThread() {
    if (listingToRename === undefined) {
      throw new Error("An Agent Thread is required before it can be renamed.");
    }

    const title = renameTitle.trim();
    if (title.length === 0) {
      setRenameError("Agent Thread title is required.");
      return;
    }

    await onThreadRename(listingToRename, title);
    setListingToRename(undefined);
    setRenameTitle("");
    setRenameError(undefined);
  }

  async function deleteThread() {
    if (listingToDelete === undefined) {
      throw new Error("An Agent Thread is required before it can be deleted.");
    }

    setIsDeleting(true);
    try {
      await onThreadDelete(listingToDelete);
      setListingToDelete(undefined);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleProjectCollapseToggle(projectId: string) {
    setCollapsedProjectIds((currentIds) =>
      currentIds.includes(projectId)
        ? currentIds.filter((id) => id !== projectId)
        : [...currentIds, projectId],
    );
  }

  async function handleRevealProjectFolder(project: Project) {
    try {
      await revealItemInDir(project.folderPath);
    } catch (error) {
      toast.error(`Failed to reveal folder: ${errorMessageFromUnknown(error)}`);
    }
  }

  async function handleCopyProjectPath(project: Project) {
    try {
      await navigator.clipboard.writeText(project.folderPath);
      toast.success("Project path copied");
    } catch (error) {
      toast.error(`Failed to copy path: ${errorMessageFromUnknown(error)}`);
    }
  }

  // Compute filtered threads and projects for the search query.
  const query = searchQuery.toLowerCase().trim();

  let filteredThreads: AgentThreadPanelListing[] | undefined;
  if (threadsState.status !== "ready") {
    filteredThreads = undefined;
  } else if (query.length === 0) {
    filteredThreads = threadsState.threads;
  } else {
    filteredThreads = threadsState.threads.filter(
      (listing) =>
        listing.panel.title.toLowerCase().includes(query) ||
        listing.project.name.toLowerCase().includes(query),
    );
  }

  let filteredProjects: CoworkProjectWithThreads[] | undefined;
  if (projectsState.status !== "ready") {
    filteredProjects = undefined;
  } else if (query.length === 0) {
    filteredProjects = projectsState.projects;
  } else {
    filteredProjects = projectsState.projects
      .map(({ project, threads }) => ({
        project,
        threads: threads.filter((t) => t.panel.title.toLowerCase().includes(query)),
      }))
      .filter(
        ({ project, threads }) => project.name.toLowerCase().includes(query) || threads.length > 0,
      );
  }

  const hasResults =
    filteredThreads !== undefined && filteredProjects !== undefined
      ? filteredThreads.length > 0 || filteredProjects.length > 0
      : true;
  return (
    <SidebarProvider className="min-h-0 w-72 shrink-0">
      <Sidebar collapsible="none" className="w-72 shrink-0">
        <div className="p-3">
          <Button
            type="button"
            className="w-full"
            disabled={isCreatingConversation}
            onClick={onNewConversation}
          >
            {isCreatingConversation ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            New conversation
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              aria-label="Search conversations"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-8 w-full rounded-md border border-border bg-editor-surface pr-8 pl-8 text-sm text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary focus:outline-none"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 scrollbar-sleek overflow-y-auto px-2 pb-2">
          {query.length > 0 && !hasResults ? (
            <SidebarNotice>{`No results for \u201C${searchQuery}\u201D`}</SidebarNotice>
          ) : (
            <>
              <CoworkThreadList
                filteredThreads={filteredThreads}
                threadsStatus={threadsState.status}
                threadsMessage={threadsState.status === "error" ? threadsState.message : undefined}
                activePanelId={activePanelId}
                onThreadClose={onThreadClose}
                onThreadDelete={setListingToDelete}
                onThreadRename={openRenameDialog}
                onThreadSelect={onThreadSelect}
              />
              <CoworkProjectList
                filteredProjects={filteredProjects}
                projectsStatus={projectsState.status}
                projectsMessage={
                  projectsState.status === "error" ? projectsState.message : undefined
                }
                activePanelId={activePanelId}
                collapsedProjectIds={collapsedProjectIds}
                onProjectCollapseToggle={handleProjectCollapseToggle}
                onProjectSelect={onProjectSelect}
                onProjectRename={setProjectToRename}
                onProjectRemove={setProjectToRemove}
                onProjectReveal={handleRevealProjectFolder}
                onProjectCopyPath={handleCopyProjectPath}
                onThreadSelect={onThreadSelect}
                onProjectCreate={onProjectCreate}
                isCreatingProject={isCreatingProject}
              />
            </>
          )}
        </div>
        <div className="border-t border-sidebar-border p-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={onSettingsOpen}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </Button>
        </div>
        <RenameAgentThreadDialog
          error={renameError}
          inputRef={renameInputRef}
          open={listingToRename !== undefined}
          title={renameTitle}
          onOpenChange={(open) => !open && setListingToRename(undefined)}
          onSubmit={() => void renameThread()}
          onTitleChange={(title) => {
            setRenameTitle(title);
            setRenameError(undefined);
          }}
        />
        <DeleteAgentThreadDialog
          open={listingToDelete !== undefined}
          isDeleting={isDeleting}
          onOpenChange={(open) => !open && setListingToDelete(undefined)}
          onConfirm={() => void deleteThread()}
        />
        <CoworkRenameProjectDialog
          project={projectToRename}
          onOpenChange={(open: boolean) => !open && setProjectToRename(undefined)}
          onProjectRename={onProjectRename}
        />
        <CoworkRemoveProjectDialog
          project={projectToRemove}
          onOpenChange={(open) => !open && setProjectToRemove(undefined)}
          onProjectRemove={onProjectRemove}
        />
      </Sidebar>
    </SidebarProvider>
  );
}

// ─── Thread list ────────────────────────────────────────────────────────────

type CoworkThreadListProps = {
  filteredThreads: AgentThreadPanelListing[] | undefined;
  threadsStatus: string;
  threadsMessage: string | undefined;
  activePanelId: string | undefined;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => void;
  onThreadRename: (listing: AgentThreadPanelListing) => void;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
};

function CoworkThreadList({
  filteredThreads,
  threadsStatus,
  threadsMessage,
  activePanelId,
  onThreadClose,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
}: CoworkThreadListProps) {
  if (threadsStatus === "loading") {
    return <SidebarNotice>Loading conversations…</SidebarNotice>;
  }

  if (threadsStatus === "error") {
    return (
      <SidebarNotice role="alert">
        {threadsMessage ?? "Failed to load conversations."}
      </SidebarNotice>
    );
  }

  if (filteredThreads === undefined || filteredThreads.length === 0) {
    return;
  }

  return (
    <ol className="space-y-1">
      {filteredThreads.map((listing) => (
        <li key={listing.panel.id}>
          <AgentThreadRow
            panel={listing.panel}
            isActive={listing.panel.id === activePanelId}
            onClose={() => onThreadClose(listing)}
            onDelete={() => onThreadDelete(listing)}
            onOpen={() => onThreadSelect(listing)}
            onRename={() => onThreadRename(listing)}
          />
        </li>
      ))}
    </ol>
  );
}

// ─── Projects section ───────────────────────────────────────────────────────

type CoworkProjectListProps = {
  filteredProjects: CoworkProjectWithThreads[] | undefined;
  projectsStatus: string;
  projectsMessage: string | undefined;
  activePanelId: string | undefined;
  collapsedProjectIds: string[];
  onProjectCollapseToggle: (projectId: string) => void;
  onProjectSelect: (project: Project) => void;
  onProjectRename: (project: Project) => void;
  onProjectRemove: (project: Project) => void;
  onProjectReveal: (project: Project) => void;
  onProjectCopyPath: (project: Project) => void;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
  isCreatingProject: boolean;
  onProjectCreate: () => void;
};

function CoworkProjectList({
  filteredProjects,
  projectsStatus,
  projectsMessage,
  activePanelId,
  collapsedProjectIds,
  onProjectCollapseToggle,
  onProjectSelect,
  onProjectRename,
  onProjectRemove,
  onProjectReveal,
  onProjectCopyPath,
  isCreatingProject,
  onThreadSelect,
  onProjectCreate,
}: CoworkProjectListProps) {
  if (projectsStatus === "loading") {
    return <SidebarNotice>Loading projects…</SidebarNotice>;
  }

  if (projectsStatus === "error") {
    return (
      <SidebarNotice role="alert">{projectsMessage ?? "Failed to load projects."}</SidebarNotice>
    );
  }

  return (
    <div className="mt-4 border-t border-sidebar-border pt-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
          Projects
        </h3>
        <button
          type="button"
          aria-label="New project"
          className="rounded p-0.5 text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
          disabled={isCreatingProject}
          onClick={onProjectCreate}
        >
          {isCreatingProject ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {filteredProjects === undefined || filteredProjects.length === 0 ? undefined : (
        <SidebarMenu aria-label="Projects">
          {filteredProjects.map(({ project, threads }) => {
            const isCollapsed = collapsedProjectIds.includes(project.id);

            return (
              <SidebarMenuItem key={project.id}>
                <ContextMenu>
                  <ContextMenuTrigger render={<div />}>
                    <SidebarMenuButton
                      className="pr-16 text-sm"
                      render={
                        <button
                          type="button"
                          aria-label={project.name}
                          onClick={() => onProjectSelect(project)}
                        />
                      }
                    >
                      <Folder aria-hidden="true" />
                      <span>{project.name}</span>
                      {threads.length > 0 && (
                        <span className="ml-auto text-xs text-sidebar-foreground/40">
                          {threads.length}
                        </span>
                      )}
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      className="opacity-0 transition-opacity duration-150 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
                      render={
                        <button
                          type="button"
                          aria-label={
                            isCollapsed ? `Expand ${project.name}` : `Collapse ${project.name}`
                          }
                          aria-expanded={!isCollapsed}
                          onClick={() => onProjectCollapseToggle(project.id)}
                        />
                      }
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={
                          isCollapsed
                            ? "transition-transform duration-150"
                            : "rotate-90 transition-transform duration-150"
                        }
                      />
                    </SidebarMenuAction>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onProjectRename(project)}>
                      <Pencil aria-hidden="true" />
                      <span>Rename</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onProjectReveal(project)}>
                      <ExternalLink aria-hidden="true" />
                      <span>Reveal Folder</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onProjectCopyPath(project)}>
                      <Copy aria-hidden="true" />
                      <span>Copy Path</span>
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onClick={() => onProjectRemove(project)}>
                      <Trash aria-hidden="true" />
                      <span>Remove from Kira</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <CoworkProjectThreads
                  isCollapsed={isCollapsed}
                  project={project}
                  threads={threads}
                  activePanelId={activePanelId}
                  onThreadSelect={onThreadSelect}
                />
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </div>
  );
}

type CoworkProjectThreadsProps = {
  isCollapsed: boolean;
  project: Project;
  threads: AgentThreadPanelListing[];
  activePanelId: string | undefined;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
};

function CoworkProjectThreads({
  isCollapsed,
  project,
  threads,
  activePanelId,
  onThreadSelect,
}: CoworkProjectThreadsProps) {
  if (threads.length === 0) {
    return (
      <div
        aria-hidden={isCollapsed}
        className={
          isCollapsed
            ? "grid grid-rows-[0fr] overflow-hidden opacity-0 transition-all duration-150 ease-out"
            : "grid grid-rows-[1fr] overflow-hidden opacity-100 transition-all duration-150 ease-out"
        }
      >
        <p className="px-9 py-1 text-xs text-sidebar-foreground/60">
          No conversations in this project
        </p>
      </div>
    );
  }

  return (
    <div
      aria-hidden={isCollapsed}
      className={
        isCollapsed
          ? "grid grid-rows-[0fr] overflow-hidden opacity-0 transition-all duration-150 ease-out"
          : "grid grid-rows-[1fr] overflow-hidden opacity-100 transition-all duration-150 ease-out"
      }
    >
      <SidebarMenuSub
        aria-label={`${project.name} conversations`}
        className="mx-0 mt-1 min-h-0 gap-1.5 overflow-hidden border-l-0 px-0"
      >
        {threads.map((listing) => (
          <SidebarMenuSubItem
            key={listing.panel.id}
            className="relative pl-5 before:absolute before:top-0 before:left-2 before:h-5 before:w-3 before:rounded-bl-md before:border-b before:border-l before:border-sidebar-border before:content-['']"
          >
            <SidebarMenuSubButton
              className="h-auto w-full items-start justify-start py-2 text-left"
              isActive={listing.panel.id === activePanelId}
              render={
                <button
                  type="button"
                  aria-label={listing.panel.title}
                  onClick={() => onThreadSelect(listing)}
                />
              }
            >
              <span className="truncate">{listing.panel.title}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </div>
  );
}

type CoworkRenameProjectDialogProps = {
  project: Project | undefined;
  onOpenChange: (open: boolean) => void;
  onProjectRename: (project: Project, name: string) => Promise<void>;
};

function CoworkRenameProjectDialog({
  project,
  onOpenChange,
  onProjectRename,
}: CoworkRenameProjectDialogProps) {
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
      await onProjectRename(project, name);
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
            <Label htmlFor="cowork-rename-project-name">Project name</Label>
            <Input
              id="cowork-rename-project-name"
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

// ─── Project remove dialog ──────────────────────────────────────────────────

type CoworkRemoveProjectDialogProps = {
  project: Project | undefined;
  onOpenChange: (open: boolean) => void;
  onProjectRemove: (projectId: string) => Promise<void>;
};

function CoworkRemoveProjectDialog({
  project,
  onOpenChange,
  onProjectRemove,
}: CoworkRemoveProjectDialogProps) {
  async function handleRemoveProject() {
    if (project === undefined) {
      return;
    }

    try {
      await onProjectRemove(project.id);
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

// ─── Shared helpers ─────────────────────────────────────────────────────────

function SidebarNotice({ children, role }: { children: string; role?: "alert" }) {
  return (
    <div
      role={role}
      className="m-1 rounded-xl border border-border p-3 text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function projectName(project: Project | undefined) {
  return project !== undefined ? project.name : "this project";
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

export { CoworkSidebar };
