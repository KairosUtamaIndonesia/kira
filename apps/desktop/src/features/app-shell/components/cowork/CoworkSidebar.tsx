import { FolderKanban, Loader2, Plus, Search, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing } from "@/features/projects/types";

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

import type { CoworkProjectWithThreads, CoworkProjectsState } from "../../hooks/useCoworkProjects";
import type { CoworkThreadsState } from "../../hooks/useCoworkThreads";

import {
  AgentThreadRow,
  DeleteAgentThreadDialog,
  RenameAgentThreadDialog,
} from "../shared/AgentThreadRow";

// ─── Types ──────────────────────────────────────────────────────────────────

type CoworkSidebarProps = {
  threadsState: CoworkThreadsState;
  projectsState: CoworkProjectsState;
  activePanelId: string | undefined;
  isCreatingConversation: boolean;
  onNewConversation: () => void;
  onSettingsOpen: () => void;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => Promise<void>;
  onThreadRename: (listing: AgentThreadPanelListing, title: string) => Promise<void>;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
  onProjectsListOpen: () => void;
};

// ─── Grouped thread model ───────────────────────────────────────────────────

type ThreadGroup =
  | { kind: "standalone"; thread: AgentThreadPanelListing }
  | { kind: "project-header"; projectName: string; projectId: string }
  | { kind: "project-thread"; thread: AgentThreadPanelListing };

function buildThreadGroups(threads: AgentThreadPanelListing[]): ThreadGroup[] {
  const standalone: AgentThreadPanelListing[] = [];
  const byProject = new Map<string, { name: string; threads: AgentThreadPanelListing[] }>();

  for (const thread of threads) {
    const isIntentional = thread.project.intentional;
    if (isIntentional) {
      const existing = byProject.get(thread.project.id);
      if (existing !== undefined) {
        existing.threads.push(thread);
      } else {
        byProject.set(thread.project.id, { name: thread.project.name, threads: [thread] });
      }
    } else {
      standalone.push(thread);
    }
  }

  const groups: ThreadGroup[] = [];

  // Standalone threads first (most recent first — already sorted).
  for (const thread of standalone) {
    groups.push({ kind: "standalone", thread });
  }

  // Project groups sorted alphabetically by name.
  // oxlint-disable-next-line unicorn/no-array-sort — toSorted() unavailable (no ES2023 lib)
  const projectEntries = [...byProject.entries()].sort(([, a], [, b]) =>
    a.name.localeCompare(b.name),
  );

  for (const [projectId, { name, threads: projectThreads }] of projectEntries) {
    groups.push({ kind: "project-header", projectName: name, projectId });
    for (const thread of projectThreads) {
      groups.push({ kind: "project-thread", thread });
    }
  }

  return groups;
}

// ─── Component ──────────────────────────────────────────────────────────────

function CoworkSidebar({
  threadsState,
  projectsState,
  activePanelId,
  isCreatingConversation,
  onNewConversation,
  onSettingsOpen,
  onThreadClose,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
  onProjectsListOpen,
}: CoworkSidebarProps) {
  const [listingToRename, setListingToRename] = useState<AgentThreadPanelListing>();
  const [listingToDelete, setListingToDelete] = useState<AgentThreadPanelListing>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
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

  // Compute filtered and grouped threads.
  const query = searchQuery.toLowerCase().trim();

  let groups: ThreadGroup[] | undefined;
  let isLoading = false;
  let isError = false;
  let errorMessage: string | undefined;

  if (threadsState.status === "loading") {
    isLoading = true;
  } else if (threadsState.status === "error") {
    isError = true;
    errorMessage = threadsState.message;
  } else {
    const filtered =
      query.length === 0
        ? threadsState.threads
        : threadsState.threads.filter(
            (listing) =>
              listing.panel.title.toLowerCase().includes(query) ||
              listing.project.name.toLowerCase().includes(query),
          );
    groups = buildThreadGroups(filtered);
  }

  const projectCount = projectsState.status === "ready" ? projectsState.projects.length : undefined;

  function renderContent() {
    if (isLoading) {
      return <SidebarNotice>Loading conversations…</SidebarNotice>;
    }

    if (isError) {
      return (
        <SidebarNotice role="alert">
          {errorMessage ?? "Failed to load conversations."}
        </SidebarNotice>
      );
    }

    if (groups === undefined || groups.length === 0) {
      return (
        <SidebarNotice>
          {query.length > 0 ? `No results for \u201C${searchQuery}\u201D` : "No conversations yet."}
        </SidebarNotice>
      );
    }

    return (
      <ol className="space-y-0.5">
        {groups.map((group) => {
          if (group.kind === "project-header") {
            return (
              <li key={`header-${group.projectId}`} className="px-2 pt-3 pb-1">
                <span className="text-xs font-medium tracking-wide text-sidebar-foreground/50 uppercase">
                  {group.projectName}
                </span>
              </li>
            );
          }

          const listing = group.thread;
          return (
            <li key={listing.panel.id}>
              <AgentThreadRow
                panel={listing.panel}
                isActive={listing.panel.id === activePanelId}
                onClose={() => onThreadClose(listing)}
                onDelete={() => onThreadDelete(listing)}
                onOpen={() => onThreadSelect(listing)}
                onRename={() => openRenameDialog(listing)}
              />
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
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
        {renderContent()}
      </div>
      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          onClick={onProjectsListOpen}
        >
          <FolderKanban aria-hidden="true" />
          <span>Projects</span>
          {projectCount !== undefined && projectCount > 0 && (
            <span className="ml-auto text-xs text-sidebar-foreground/40">{projectCount}</span>
          )}
        </Button>
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
    </aside>
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

export { CoworkSidebar };
