import { invoke } from "@tauri-apps/api/core";

import type {
  CreatedProject,
  CreateProjectInput,
  CreateTerminalPanelInput,
  DeleteWorkspacePanelInput,
  OpenProject,
  OpenProjectInput,
  Project,
  RemoveProjectInput,
  RenameProjectInput,
  UpdateSessionLayoutInput,
  WorkspacePanel,
} from "../types";

function listProjects() {
  return invoke<Project[]>("project_list");
}

function createProject(input: CreateProjectInput) {
  return invoke<CreatedProject>("project_create", { input });
}

function openProject(input: OpenProjectInput) {
  return invoke<OpenProject>("project_open", { input });
}

function openLastProject() {
  return invoke<OpenProject | null>("project_open_last");
}

function createTerminalPanel(input: CreateTerminalPanelInput) {
  return invoke<WorkspacePanel>("workspace_terminal_panel_create", { input });
}

function deleteWorkspacePanel(input: DeleteWorkspacePanelInput) {
  return invoke<void>("workspace_panel_delete", { input });
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
  createProject,
  createTerminalPanel,
  deleteWorkspacePanel,
  listProjects,
  openLastProject,
  openProject,
  removeProject,
  renameProject,
  updateSessionLayout,
};
