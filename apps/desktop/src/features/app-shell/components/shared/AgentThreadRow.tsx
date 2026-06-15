import type { RefObject } from "react";

import { Copy, MoreVertical, PenLine, RotateCcw, Trash2, X } from "lucide-react";

import type { AgentThreadWorkspacePanel } from "@/features/projects/types";

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
import { useAgentThreadTitleGenerationState } from "@/features/agent-thread/agentThreadStatusStore";
import { cn } from "@/lib/utils";

import { ThreadTitleText } from "./ThreadTitleText";

// Canonical Agent Thread row shared by the Code Inspector and the Cowork
// Sidebar. Both surfaces render the same row UI and menus; only the state
// management around the rename/delete dialogs lives with the caller.

type AgentThreadRowProps = {
  panel: AgentThreadWorkspacePanel;
  isActive?: boolean;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onRename: () => void;
};

function AgentThreadRow({
  panel,
  isActive = false,
  onClose,
  onDelete,
  onOpen,
  onRename,
}: AgentThreadRowProps) {
  const titleGeneration = useAgentThreadTitleGenerationState(panel.agentThreadState.threadId);
  const isGeneratingTitle = titleGeneration.status === "generating";

  async function handleCopyThreadId() {
    try {
      await navigator.clipboard.writeText(panel.agentThreadState.threadId);
    } catch {
      // Clipboard access may be denied; fail silently.
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="group relative" />}>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-auto w-full justify-start px-2 py-2 pr-9 text-left", {
            "bg-accent text-accent-foreground": isActive,
          })}
          onClick={onOpen}
        >
          <ThreadTitleText
            className="text-sm font-medium"
            isGenerating={isGeneratingTitle}
            text={panel.title}
          />
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
            onCopyThreadId={handleCopyThreadId}
            onDelete={onDelete}
            onOpen={onOpen}
            onRename={onRename}
          />
        </DropdownMenu>
      </ContextMenuTrigger>
      <AgentThreadContextMenuContent
        onClose={onClose}
        onCopyThreadId={handleCopyThreadId}
        onDelete={onDelete}
        onOpen={onOpen}
        onRename={onRename}
      />
    </ContextMenu>
  );
}

type AgentThreadMenuContentProps = {
  onClose: () => void;
  onCopyThreadId: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onRename: () => void;
};

function AgentThreadContextMenuContent({
  onClose,
  onCopyThreadId,
  onDelete,
  onOpen,
  onRename,
}: AgentThreadMenuContentProps) {
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
      <ContextMenuItem onClick={onCopyThreadId}>
        <Copy className="size-4 text-muted-foreground" />
        <span>Copy Thread ID</span>
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
  onCopyThreadId,
  onDelete,
  onOpen,
  onRename,
}: AgentThreadMenuContentProps) {
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
      <DropdownMenuItem onClick={onCopyThreadId}>
        <Copy className="size-4 text-muted-foreground" />
        <span>Copy Thread ID</span>
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

type DeleteAgentThreadDialogProps = {
  open: boolean;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function DeleteAgentThreadDialog({
  open,
  isDeleting,
  onOpenChange,
  onConfirm,
}: DeleteAgentThreadDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Agent Thread?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the Agent Thread from this Session. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={onConfirm}>
            Delete Agent Thread
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { AgentThreadRow, DeleteAgentThreadDialog, RenameAgentThreadDialog };
