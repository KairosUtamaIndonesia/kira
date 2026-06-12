import { useEffect, useRef, useState } from "react";

import type { AgentThreadWorkspacePanel, WorkspacePanel } from "@/features/projects/types";

import type { ActiveWorkspaceState } from "../types";

import { AgentThreadRow, DeleteAgentThreadDialog, RenameAgentThreadDialog } from "./AgentThreadRow";

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
      <DeleteAgentThreadDialog
        open={panelToDelete !== undefined}
        isDeleting={isDeleting}
        onOpenChange={(open) => !open && setPanelToDelete(undefined)}
        onConfirm={() => void deletePanel()}
      />
    </>
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
