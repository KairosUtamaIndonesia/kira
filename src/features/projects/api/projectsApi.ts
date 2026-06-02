import { invoke } from "@tauri-apps/api/core";

import type {
  CreatedProject,
  CreateProjectInput,
  OpenProject,
  OpenProjectInput,
  Project,
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

export { createProject, listProjects, openLastProject, openProject };
