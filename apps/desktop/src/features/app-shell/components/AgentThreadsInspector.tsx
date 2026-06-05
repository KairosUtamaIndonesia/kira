import { MoreVertical, PenLine, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { AgentThreadWorkspacePanel, WorkspacePanel } from "@/features/projects/types";

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
  ContextMenuSeparator,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import type { ActiveWorkspaceState } from "../types";

type AgentThreadsInspectorProps = {
  activeWorkspace: ActiveWorkspaceState;
  onAgentThreadClose: (panelId: string) => void;
  onAgentThreadDelete: (panelId: string) => Promise<void>;
  onAgentThreadOpen: (panelId: string) => void;
  onAgentThreadRename: (panelId: string, title: string) => Promise<void>;
};

function AgentThreadsInspector({
  activeWorkspace,
  onAgentThreadClose,
  onAgentThreadDelete,
  onAgentThreadOpen,
  onAgentThreadRename,
}: AgentThreadsInspectorProps) {
  const [panelToRename, setPanelToRename] = useState<AgentThreadWorkspacePanel>();
  const [panelToDelete, setPanelToDelete] = useState<AgentThreadWorkspacePanel>();
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panelToRename !== undefined) {
      const input = renameInputRef.current;
      if (input !== null) {
        input.focus();
      }
    }
  }, [panelToRename]);

  if (activeWorkspace.status === "loading") {
    return <InspectorNotice>Opening project…</InspectorNotice>;
  }

  if (activeWorkspace.status === "error") {
    return <InspectorNotice role="alert">{activeWorkspace.message}</InspectorNotice>;
  }

  if (activeWorkspace.status !== "active") {
    return <InspectorNotice>Select a Project to view Agent Threads.</InspectorNotice>;
  }

  const agentThreadPanels = activeWorkspace.panels.filter(isAgentThreadPanel);
  if (agentThreadPanels.length === 0) {
    return <InspectorNotice>This Session has no Agent Threads.</InspectorNotice>;
  }

  function openRenameDialog(panel: AgentThreadWorkspacePanel) {
    setPanelToRename(panel);
    setRenameTitle(panel.title);
    setRenameError(undefined);
  }

  async function renamePanel() {
    if (panelToRename === undefined) {
      throw new Error("An Agent Thread is required before it can be renamed.");
    }

    const title = renameTitle.trim();
    if (title.length === 0) {
      setRenameError("Agent Thread title is required.");
      return;
    }

    await onAgentThreadRename(panelToRename.id, title);
    setPanelToRename(undefined);
    setRenameTitle("");
    setRenameError(undefined);
  }

  async function deletePanel() {
    if (panelToDelete === undefined) {
      throw new Error("An Agent Thread is required before it can be deleted.");
    }

    setIsDeleting(true);
    try {
      await onAgentThreadDelete(panelToDelete.id);
      setPanelToDelete(undefined);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <section className="space-y-2 p-3" aria-labelledby="agent-threads-heading">
        <div className="space-y-1">
          <h2 id="agent-threads-heading" className="text-sm font-medium text-foreground">
            Agent Threads
          </h2>
          <p className="text-xs text-muted-foreground">
            Reopen Agent Thread panels in this Session.
          </p>
        </div>
        <ol className="space-y-1">
          {agentThreadPanels.map((panel) => (
            <li key={panel.id}>
              <AgentThreadRow
                panel={panel}
                onClose={() => onAgentThreadClose(panel.id)}
                onDelete={() => setPanelToDelete(panel)}
                onOpen={() => onAgentThreadOpen(panel.id)}
                onRename={() => openRenameDialog(panel)}
              />
            </li>
          ))}
        </ol>
      </section>
      <RenameAgentThreadDialog
        error={renameError}
        inputRef={renameInputRef}
        open={panelToRename !== undefined}
        title={renameTitle}
        onOpenChange={(open) => !open && setPanelToRename(undefined)}
        onSubmit={() => void renamePanel()}
        onTitleChange={(title) => {
          setRenameTitle(title);
          setRenameError(undefined);
        }}
      />
      <AlertDialog
        open={panelToDelete !== undefined}
        onOpenChange={(open) => !open && setPanelToDelete(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent Thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Agent Thread from this Session. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void deletePanel()}
            >
              Delete Agent Thread
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type AgentThreadRowProps = {
  panel: AgentThreadWorkspacePanel;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onRename: () => void;
};

function AgentThreadRow({ panel, onClose, onDelete, onOpen, onRename }: AgentThreadRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="group relative" />}>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start px-2 py-2 pr-9 text-left"
          onClick={onOpen}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{panel.title}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {panel.agentThreadState.threadId}
            </span>
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Agent Thread actions for ${panel.title}`}
            className="absolute top-1.5 right-1 rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <AgentThreadDropdownMenuContent
            onClose={onClose}
            onDelete={onDelete}
            onOpen={onOpen}
            onRename={onRename}
          />
        </DropdownMenu>
      </ContextMenuTrigger>
      <AgentThreadContextMenuContent
        onClose={onClose}
        onDelete={onDelete}
        onOpen={onOpen}
        onRename={onRename}
      />
    </ContextMenu>
  );
}

function AgentThreadContextMenuContent({
  onClose,
  onDelete,
  onOpen,
  onRename,
}: Omit<AgentThreadRowProps, "panel">) {
  return (
    <ContextMenuContent className="w-auto min-w-48">
      <ContextMenuItem onClick={onOpen}>
        <RotateCcw className="size-4 text-muted-foreground" />
        <span>Open Agent Thread</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onRename}>
        <PenLine className="size-4 text-muted-foreground" />
        <span>Rename Agent Thread</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={onClose}>
        <X className="size-4 text-muted-foreground" />
        <span>Close Panel</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" />
        <span>Delete Agent Thread…</span>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function AgentThreadDropdownMenuContent({
  onClose,
  onDelete,
  onOpen,
  onRename,
}: Omit<AgentThreadRowProps, "panel">) {
  return (
    <DropdownMenuContent align="end" className="w-auto min-w-48">
      <DropdownMenuItem onClick={onOpen}>
        <RotateCcw className="size-4 text-muted-foreground" />
        <span>Open Agent Thread</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onRename}>
        <PenLine className="size-4 text-muted-foreground" />
        <span>Rename Agent Thread</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onClose}>
        <X className="size-4 text-muted-foreground" />
        <span>Close Panel</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" />
        <span>Delete Agent Thread…</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

type RenameAgentThreadDialogProps = {
  error: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onTitleChange: (title: string) => void;
};

function RenameAgentThreadDialog({
  error,
  inputRef,
  open,
  title,
  onOpenChange,
  onSubmit,
  onTitleChange,
}: RenameAgentThreadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Agent Thread</DialogTitle>
          <DialogDescription>
            Choose the title shown in the Inspector and Workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Input
            ref={inputRef}
            aria-label="Agent Thread title"
            aria-invalid={error !== undefined}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
          {error === undefined ? undefined : <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InspectorNotice({ children, role }: { children: string; role?: "alert" }) {
  return (
    <div role={role} className="m-3 rounded-xl border border-border p-3 text-muted-foreground">
      {children}
    </div>
  );
}

function isAgentThreadPanel(panel: WorkspacePanel): panel is AgentThreadWorkspacePanel {
  return panel.kind === "agent_thread";
}

export { AgentThreadsInspector };
