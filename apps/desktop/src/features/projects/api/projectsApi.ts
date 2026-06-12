import { invoke } from "@tauri-apps/api/core";

import type {
  AgentThreadPanelListing,
  AgentThreadWorkspacePanel,
  CreatedProject,
  CreateAgentThreadPanelInput,
  CreateBrowserPanelInput,
  CreateProjectInput,
  CreateProjectSessionInput,
  CreateTerminalPanelInput,
  DeleteTerminalSnapshotInput,
  DeleteWorkspacePanelInput,
  DeleteProjectSessionInput,
  GetTerminalSnapshotInput,
  OpenFileEditorPanelInput,
  ListProjectSessionsInput,
  OpenProject,
  OpenProjectInput,
  OpenProjectSessionInput,
  OpenSourceControlDiffPanelInput,
  Project,
  RemoveProjectInput,
  RenameProjectInput,
  RenameWorkspacePanelInput,
  SaveTerminalSnapshotInput,
  Session,
  TerminalSnapshot,
  UpdateSessionLayoutInput,
  WorkspacePanel,
  UpdateBrowserPanelUrlInput,
} from "../types";

function listProjects() {
  return invoke<Project[]>("project_list");
}

function createProject(input: CreateProjectInput) {
  return invoke<CreatedProject>("project_create", { input });
}

function createCoworkProject() {
  return invoke<CreatedProject>("cowork_project_create");
}

// Every Agent Thread across all Cowork projects, most recent first. Code
// projects' threads never appear here.
async function listCoworkAgentThreadPanels(): Promise<AgentThreadPanelListing[]> {
  type AgentThreadPanelListingRow = Omit<AgentThreadPanelListing, "panel"> & {
    panel: WorkspacePanel;
  };

  const listings = await invoke<AgentThreadPanelListingRow[]>("cowork_agent_thread_panels_list");
  return listings.map((listing) => ({
    project: listing.project,
    sessionId: listing.sessionId,
    panel: requireAgentThreadPanel(listing.panel),
  }));
}

function requireAgentThreadPanel(panel: WorkspacePanel): AgentThreadWorkspacePanel {
  if (panel.kind !== "agent_thread") {
    throw new Error(`Expected Agent Thread panel, received ${panel.kind}.`);
  }

  return panel;
}

function openProject(input: OpenProjectInput) {
  return invoke<OpenProject>("project_open", { input });
}

function openLastProject() {
  return invoke<OpenProject | null>("project_open_last");
}

function listProjectSessions(input: ListProjectSessionsInput) {
  return invoke<Session[]>("project_sessions_list", { input });
}

function openProjectSession(input: OpenProjectSessionInput) {
  return invoke<OpenProject>("project_session_open", { input });
}

function createProjectSession(input: CreateProjectSessionInput) {
  return invoke<Session>("project_session_create", { input });
}

function deleteProjectSession(input: DeleteProjectSessionInput) {
  return invoke<void>("project_session_delete", { input });
}

function createTerminalPanel(input: CreateTerminalPanelInput) {
  return invoke<WorkspacePanel>("workspace_terminal_panel_create", { input });
}

function createAgentThreadPanel(input: CreateAgentThreadPanelInput) {
  return invoke<WorkspacePanel>("workspace_agent_thread_panel_create", { input });
}

function createBrowserPanel(input: CreateBrowserPanelInput) {
  return invoke<WorkspacePanel>("workspace_browser_panel_create", { input });
}

function updateBrowserPanelUrl(input: UpdateBrowserPanelUrlInput) {
  return invoke<void>("workspace_browser_panel_url_update", { input });
}

function openSourceControlDiffPanel(input: OpenSourceControlDiffPanelInput) {
  return invoke<WorkspacePanel>("workspace_source_control_diff_panel_open", { input });
}

function openFileEditorPanel(input: OpenFileEditorPanelInput) {
  return invoke<WorkspacePanel>("workspace_file_editor_panel_open", { input });
}

function deleteWorkspacePanel(input: DeleteWorkspacePanelInput) {
  return invoke<void>("workspace_panel_delete", { input });
}

function renameWorkspacePanel(input: RenameWorkspacePanelInput) {
  return invoke<WorkspacePanel>("workspace_panel_rename", { input });
}

function getTerminalSnapshot(input: GetTerminalSnapshotInput) {
  return invoke<TerminalSnapshot | null>("workspace_terminal_snapshot_get", { input });
}

function saveTerminalSnapshot(input: SaveTerminalSnapshotInput) {
  return invoke<TerminalSnapshot>("workspace_terminal_snapshot_save", { input });
}

function deleteTerminalSnapshot(input: DeleteTerminalSnapshotInput) {
  return invoke<void>("workspace_terminal_snapshot_delete", { input });
}

function renameProject(input: RenameProjectInput) {
  return invoke<Project>("project_rename", { input });
}

function removeProject(input: RemoveProjectInput) {
  return invoke<void>("project_remove", { input });
}

function updateSessionLayout(input: UpdateSessionLayoutInput) {
  return invoke<void>("session_layout_update", { input });
}

export {
  createAgentThreadPanel,
  createBrowserPanel,
  createCoworkProject,
  createProject,
  listCoworkAgentThreadPanels,
  createProjectSession,
  createTerminalPanel,
  deleteTerminalSnapshot,
  deleteWorkspacePanel,
  deleteProjectSession,
  getTerminalSnapshot,
  listProjectSessions,
  listProjects,
  openFileEditorPanel,
  openLastProject,
  openProject,
  openProjectSession,
  openSourceControlDiffPanel,
  removeProject,
  renameProject,
  renameWorkspacePanel,
  saveTerminalSnapshot,
  updateBrowserPanelUrl,
  updateSessionLayout,
};
