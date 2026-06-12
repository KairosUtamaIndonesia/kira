import { MessageCirclePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing } from "@/features/projects/types";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { AgentThreadPanel } from "@/features/agent-thread";
import {
  createAgentThreadPanel,
  createCoworkProject,
  deleteWorkspacePanel,
  renameWorkspacePanel,
} from "@/features/projects/api/projectsApi";
import { SettingsPage } from "@/features/settings";

import { useCoworkThreads } from "../hooks/useCoworkThreads";
import { AppWindowControls } from "./AppWindowControls";
import { CoworkSidebar } from "./CoworkSidebar";
import { ModeMenuButton } from "./ModeMenuButton";
import { useTitleBarDrag } from "./useTitleBarDrag";

type SettingsSurfaceState = "closed" | "opening" | "open" | "closing";

// Thread-first shell for non-developers: one chat column, no Workspace
// panels, no Inspector, no Session switching. Each conversation lives in its
// own auto-created Cowork Project's default Session.
function CoworkShell() {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const { state: threadsState, refresh: refreshThreads } = useCoworkThreads();
  const [activeThread, setActiveThread] = useState<AgentThreadPanelListing>();
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [settingsSurfaceState, setSettingsSurfaceState] = useState<SettingsSurfaceState>("closed");
  const settingsReturnFocusRef = useRef<HTMLElement | undefined>(void 0);
  const didAutoSelectRef = useRef(false);

  // Resume the most recent conversation once on startup; afterwards the
  // selection is entirely user-driven (closing a thread must stay closed).
  useEffect(() => {
    if (didAutoSelectRef.current || threadsState.status !== "ready") {
      return;
    }

    didAutoSelectRef.current = true;
    const mostRecentThread = threadsState.threads[0];
    if (mostRecentThread !== undefined) {
      setActiveThread(mostRecentThread);
    }
  }, [threadsState]);

  async function handleNewConversation() {
    setIsCreatingConversation(true);
    try {
      const createdProject = await createCoworkProject();
      const panel = await createAgentThreadPanel({
        sessionId: createdProject.defaultSession.id,
        title: "New Thread",
      });
      if (panel.kind !== "agent_thread") {
        throw new Error(`Expected Agent Thread panel, received ${panel.kind}.`);
      }

      setActiveThread({
        project: createdProject.project,
        sessionId: createdProject.defaultSession.id,
        panel,
      });
      await refreshThreads();
    } catch (error) {
      toast.error(`Failed to start a conversation: ${errorMessageFromUnknown(error)}`);
    } finally {
      setIsCreatingConversation(false);
    }
  }

  function handleThreadClose(listing: AgentThreadPanelListing) {
    setActiveThread((currentThread) => {
      if (currentThread === undefined || currentThread.panel.id !== listing.panel.id) {
        return currentThread;
      }

      return void 0;
    });
  }

  async function handleThreadDelete(listing: AgentThreadPanelListing) {
    // Deselect first so the live thread connection unmounts before its panel
    // record disappears.
    handleThreadClose(listing);
    try {
      await deleteWorkspacePanel({ panelId: listing.panel.id });
      await refreshThreads();
    } catch (error) {
      toast.error(`Failed to delete Agent Thread: ${errorMessageFromUnknown(error)}`);
    }
  }

  async function handleThreadRename(listing: AgentThreadPanelListing, title: string) {
    try {
      const panel = await renameWorkspacePanel({ panelId: listing.panel.id, title });
      if (panel.kind !== "agent_thread") {
        throw new Error(`Expected renamed Agent Thread panel, received ${panel.kind}.`);
      }

      setActiveThread((currentThread) => {
        if (currentThread === undefined || currentThread.panel.id !== panel.id) {
          return currentThread;
        }

        return { ...currentThread, panel };
      });
      await refreshThreads();
    } catch (error) {
      toast.error(`Failed to rename Agent Thread: ${errorMessageFromUnknown(error)}`);
      throw error;
    }
  }

  function setActiveThreadTitle(panelId: string, title: string) {
    setActiveThread((currentThread) => {
      if (currentThread === undefined || currentThread.panel.id !== panelId) {
        return currentThread;
      }

      return { ...currentThread, panel: { ...currentThread.panel, title } };
    });
  }

  function handleSettingsOpen() {
    if (settingsSurfaceState !== "closed") {
      return;
    }

    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setSettingsSurfaceState("opening");
  }

  function handleSettingsClosed() {
    setSettingsSurfaceState("closed");
    if (settingsReturnFocusRef.current !== undefined) {
      settingsReturnFocusRef.current.focus();
    }
    settingsReturnFocusRef.current = undefined;
  }

  return (
    <div className="grid h-dvh grid-rows-[2.75rem_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <header
        role="toolbar"
        aria-label="Cowork title bar"
        tabIndex={-1}
        className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground select-none"
        onDoubleClick={(event) => {
          void handleTitleBarDoubleClick(event);
        }}
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Kira</span>
          <ModeMenuButton />
        </div>
        <AppWindowControls />
        {titleBarError === undefined ? undefined : (
          <output className="sr-only">{titleBarError}</output>
        )}
      </header>
      <div className="flex min-h-0">
        <CoworkSidebar
          threadsState={threadsState}
          activePanelId={activeThread === undefined ? undefined : activeThread.panel.id}
          isCreatingConversation={isCreatingConversation}
          onNewConversation={() => void handleNewConversation()}
          onSettingsOpen={handleSettingsOpen}
          onThreadClose={handleThreadClose}
          onThreadDelete={handleThreadDelete}
          onThreadRename={handleThreadRename}
          onThreadSelect={setActiveThread}
        />
        <main className="min-h-0 min-w-0 flex-1 bg-editor-surface">
          {activeThread === undefined ? (
            <CoworkEmptyState
              isCreatingConversation={isCreatingConversation}
              onNewConversation={() => void handleNewConversation()}
            />
          ) : (
            <AgentThreadPanel
              key={activeThread.panel.agentThreadState.threadId}
              api={{ setTitle: (title) => setActiveThreadTitle(activeThread.panel.id, title) }}
              params={{
                projectId: activeThread.project.id,
                folderPath: activeThread.project.folderPath,
                sessionId: activeThread.sessionId,
                threadId: activeThread.panel.agentThreadState.threadId,
                panelId: activeThread.panel.id,
                title: activeThread.panel.title,
              }}
              onRename={(panelId, title) =>
                handleThreadRename(requireListing(activeThread, panelId), title)
              }
            />
          )}
        </main>
      </div>
      {settingsSurfaceState === "closed" ? undefined : (
        <SettingsPage
          state={settingsSurfaceState}
          onClose={() =>
            setSettingsSurfaceState((currentState) =>
              currentState === "closed" || currentState === "closing" ? currentState : "closing",
            )
          }
          onClosed={handleSettingsClosed}
          onEntered={() =>
            setSettingsSurfaceState((currentState) =>
              currentState === "opening" ? "open" : currentState,
            )
          }
        />
      )}
    </div>
  );
}

function requireListing(listing: AgentThreadPanelListing, panelId: string) {
  if (listing.panel.id !== panelId) {
    throw new Error(`Expected the active Agent Thread panel ${panelId}.`);
  }

  return listing;
}

type CoworkEmptyStateProps = {
  isCreatingConversation: boolean;
  onNewConversation: () => void;
};

function CoworkEmptyState({ isCreatingConversation, onNewConversation }: CoworkEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-dashed border-border p-6 text-center">
        <div className="font-medium text-foreground">Start a conversation</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Ask anything. Each conversation gets its own Project, and files you share with it stay
          there.
        </div>
        <Button
          type="button"
          className="mt-4"
          disabled={isCreatingConversation}
          onClick={onNewConversation}
        >
          <MessageCirclePlus aria-hidden="true" />
          New conversation
        </Button>
      </div>
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

  return "The operation failed.";
}

export { CoworkShell };
