import { Loader2, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing } from "@/features/projects/types";

import { Button } from "@/components/ui/button";

import type { CoworkThreadsState } from "../hooks/useCoworkThreads";

import { AgentThreadRow, DeleteAgentThreadDialog, RenameAgentThreadDialog } from "./AgentThreadRow";

type CoworkSidebarProps = {
  threadsState: CoworkThreadsState;
  activePanelId: string | undefined;
  isCreatingConversation: boolean;
  onNewConversation: () => void;
  onSettingsOpen: () => void;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => Promise<void>;
  onThreadRename: (listing: AgentThreadPanelListing, title: string) => Promise<void>;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
};

function CoworkSidebar({
  threadsState,
  activePanelId,
  isCreatingConversation,
  onNewConversation,
  onSettingsOpen,
  onThreadClose,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
}: CoworkSidebarProps) {
  const [listingToRename, setListingToRename] = useState<AgentThreadPanelListing>();
  const [listingToDelete, setListingToDelete] = useState<AgentThreadPanelListing>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listingToRename !== undefined) {
      const input = renameInputRef.current;
      if (input !== null) {
        input.focus();
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

  return (
    <aside
      aria-label="Conversations"
      className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
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
      <div className="min-h-0 flex-1 scrollbar-sleek overflow-y-auto px-2 pb-2">
        <CoworkThreadList
          threadsState={threadsState}
          activePanelId={activePanelId}
          onThreadClose={onThreadClose}
          onThreadDelete={setListingToDelete}
          onThreadRename={openRenameDialog}
          onThreadSelect={onThreadSelect}
        />
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
    </aside>
  );
}

type CoworkThreadListProps = {
  threadsState: CoworkThreadsState;
  activePanelId: string | undefined;
  onThreadClose: (listing: AgentThreadPanelListing) => void;
  onThreadDelete: (listing: AgentThreadPanelListing) => void;
  onThreadRename: (listing: AgentThreadPanelListing) => void;
  onThreadSelect: (listing: AgentThreadPanelListing) => void;
};

// Threads are the first-class citizen in Cowork: a flat, most-recent-first
// list. The Cowork project backing each thread is an implementation detail
// and never surfaces in the UI.
function CoworkThreadList({
  threadsState,
  activePanelId,
  onThreadClose,
  onThreadDelete,
  onThreadRename,
  onThreadSelect,
}: CoworkThreadListProps) {
  if (threadsState.status === "loading") {
    return <SidebarNotice>Loading conversations…</SidebarNotice>;
  }

  if (threadsState.status === "error") {
    return <SidebarNotice role="alert">{threadsState.message}</SidebarNotice>;
  }

  if (threadsState.threads.length === 0) {
    return <SidebarNotice>No conversations yet. Start one to begin.</SidebarNotice>;
  }

  return (
    <ol className="space-y-1">
      {threadsState.threads.map((listing) => (
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
