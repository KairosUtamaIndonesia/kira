import { invoke } from "@tauri-apps/api/core";

import type { CreatedProject, CreateProjectInput, Project } from "../types";

function listProjects() {
  return invoke<Project[]>("project_list");
}

function createProject(input: CreateProjectInput) {
  return invoke<CreatedProject>("project_create", { input });
}

export { createProject, listProjects };
