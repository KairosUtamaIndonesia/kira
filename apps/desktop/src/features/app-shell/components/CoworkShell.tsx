import { MessageCirclePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing, Project } from "@/features/projects/types";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { AgentThreadPanel } from "@/features/agent-thread";
import {
  createAgentThreadPanel,
  createCoworkProject,
  deleteWorkspacePanel,
  removeProject,
  renameProject,
  renameWorkspacePanel,
} from "@/features/projects/api/projectsApi";
import { SettingsPage } from "@/features/settings";

import { useCoworkProjects } from "../hooks/useCoworkProjects";
import { useCoworkThreads } from "../hooks/useCoworkThreads";
import { AppWindowControls } from "./AppWindowControls";
import { CoworkProjectDetail } from "./CoworkProjectDetail";
import { CoworkSidebar } from "./CoworkSidebar";
import { ModeMenuButton } from "./ModeMenuButton";
import { useTitleBarDrag } from "./useTitleBarDrag";

type SettingsSurfaceState = "closed" | "opening" | "open" | "closing";

type CoworkView =
  | { kind: "chat"; thread: AgentThreadPanelListing }
  | { kind: "project-detail"; project: Project }
  | { kind: "empty" };

function CoworkShell() {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();
  const { state: projectsState, refresh: refreshProjects } = useCoworkProjects();
  const { state: threadsState, refresh: refreshThreads } = useCoworkThreads();
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [currentView, setCurrentView] = useState<CoworkView>({ kind: "empty" });
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [settingsSurfaceState, setSettingsSurfaceState] = useState<SettingsSurfaceState>("closed");
  const settingsReturnFocusRef = useRef<HTMLElement | undefined>(void 0);
  const previousViewRef = useRef<CoworkView | undefined>(void 0);
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
      setCurrentView({ kind: "chat", thread: mostRecentThread });
    }
  }, [threadsState]);

  async function handleNewConversation() {
    setIsCreatingConversation(true);
    try {
      const createdProject = await createCoworkProject(false);
      const panel = await createAgentThreadPanel({
        sessionId: createdProject.defaultSession.id,
        title: "New Thread",
      });
      if (panel.kind !== "agent_thread") {
        throw new Error(`Expected Agent Thread panel, received ${panel.kind}.`);
      }

      setCurrentView({
        kind: "chat",
        thread: {
          project: createdProject.project,
          sessionId: createdProject.defaultSession.id,
          panel,
        },
      });
      await refreshThreads();
    } catch (error) {
      toast.error(`Failed to start a conversation: ${errorMessageFromUnknown(error)}`);
    } finally {
      setIsCreatingConversation(false);
    }
  }

  function handleProjectSelect(project: Project) {
    // Save the current view so the back button can return to it.
    previousViewRef.current = currentView;
    setCurrentView({ kind: "project-detail", project });
  }

  function handleProjectDetailBack() {
    const previous = previousViewRef.current;
    if (previous !== undefined) {
      setCurrentView(previous);
      previousViewRef.current = undefined;
    } else {
      setCurrentView({ kind: "empty" });
    }
  }

  function handleProjectDetailRenamed(updatedProject: Project) {
    setCurrentView({ kind: "project-detail", project: updatedProject });
    void refreshProjects();
  }

  function handleProjectDetailRemoved() {
    setCurrentView({ kind: "empty" });
    void refreshProjects();
    void refreshThreads();
  }

  async function handleProjectCreate() {
    setIsCreatingProject(true);
    try {
      const created = await createCoworkProject(true);
      await refreshProjects();
      await refreshThreads();
      previousViewRef.current = currentView;
      setCurrentView({ kind: "project-detail", project: created.project });
    } catch (error) {
      toast.error(`Failed to create project: ${errorMessageFromUnknown(error)}`);
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleProjectRename(project: Project, name: string) {
    await renameProject({ projectId: project.id, name });
    await refreshProjects();
  }

  async function handleProjectRemove(projectId: string) {
    await removeProject({ projectId });
    await refreshProjects();
    await refreshThreads();
  }

  function handleThreadClose(listing: AgentThreadPanelListing) {
    setCurrentView((current) => {
      if (current.kind !== "chat" || current.thread.panel.id !== listing.panel.id) {
        return current;
      }

      return { kind: "empty" };
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

      setCurrentView((current) => {
        if (current.kind !== "chat" || current.thread.panel.id !== panel.id) {
          return current;
        }

        return { kind: "chat", thread: { ...current.thread, panel } };
      });
      await refreshThreads();
    } catch (error) {
      toast.error(`Failed to rename Agent Thread: ${errorMessageFromUnknown(error)}`);
      throw error;
    }
  }

  function setActiveThreadTitle(panelId: string, title: string) {
    setCurrentView((current) => {
      if (current.kind !== "chat" || current.thread.panel.id !== panelId) {
        return current;
      }

      return {
        kind: "chat",
        thread: { ...current.thread, panel: { ...current.thread.panel, title } },
      };
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

  function renderMainContent() {
    switch (currentView.kind) {
      case "empty":
        return (
          <CoworkEmptyState
            isCreatingConversation={isCreatingConversation}
            onNewConversation={() => void handleNewConversation()}
          />
        );
      case "project-detail":
        return (
          <CoworkProjectDetail
            project={currentView.project}
            onBack={handleProjectDetailBack}
            onThreadSelect={(listing) => setCurrentView({ kind: "chat", thread: listing })}
            onProjectRenamed={handleProjectDetailRenamed}
            onProjectRemoved={handleProjectDetailRemoved}
          />
        );
      case "chat":
        return (
          <ChatView
            thread={currentView.thread}
            onRename={handleThreadRename}
            onTitleChange={setActiveThreadTitle}
          />
        );
    }
  }

  const activeThread = currentView.kind === "chat" ? currentView.thread : undefined;

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
          projectsState={projectsState}
          activePanelId={activeThread === undefined ? undefined : activeThread.panel.id}
          isCreatingConversation={isCreatingConversation}
          onNewConversation={() => void handleNewConversation()}
          isCreatingProject={isCreatingProject}
          onSettingsOpen={handleSettingsOpen}
          onThreadClose={handleThreadClose}
          onThreadDelete={handleThreadDelete}
          onThreadRename={handleThreadRename}
          onThreadSelect={(listing) => setCurrentView({ kind: "chat", thread: listing })}
          onProjectSelect={handleProjectSelect}
          onProjectCreate={() => void handleProjectCreate()}
          onProjectRename={handleProjectRename}
          onProjectRemove={handleProjectRemove}
        />
        <main className="min-h-0 min-w-0 flex-1 bg-editor-surface">{renderMainContent()}</main>
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

type ChatViewProps = {
  thread: AgentThreadPanelListing;
  onRename: (listing: AgentThreadPanelListing, title: string) => Promise<void>;
  onTitleChange: (panelId: string, title: string) => void;
};

function ChatView({ thread, onRename, onTitleChange }: ChatViewProps) {
  return (
    <AgentThreadPanel
      key={thread.panel.agentThreadState.threadId}
      api={{ setTitle: (title) => onTitleChange(thread.panel.id, title) }}
      params={{
        projectId: thread.project.id,
        folderPath: thread.project.folderPath,
        sessionId: thread.sessionId,
        threadId: thread.panel.agentThreadState.threadId,
        panelId: thread.panel.id,
        title: thread.panel.title,
      }}
      onRename={(panelId, title) => onRename(requireListing(thread, panelId), title)}
    />
  );
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
