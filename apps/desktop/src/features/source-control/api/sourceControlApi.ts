import { invoke } from "@tauri-apps/api/core";

import type {
  SourceControlCommitInput,
  SourceControlPathInput,
  SourceControlPathsInput,
  SourceControlProjectInput,
  SourceControlStatusResult,
} from "../types";

function getSourceControlStatus(input: SourceControlProjectInput) {
  return invoke<SourceControlStatusResult>("source_control_status", { input });
}

function stageSourceControlPath(input: SourceControlPathInput) {
  return invoke<void>("source_control_stage_path", { input });
}

function unstageSourceControlPath(input: SourceControlPathInput) {
  return invoke<void>("source_control_unstage_path", { input });
}

function discardSourceControlPath(input: SourceControlPathInput) {
  return invoke<void>("source_control_discard_path", { input });
}

function stageSourceControlPaths(input: SourceControlPathsInput) {
  return invoke<void>("source_control_stage_paths", { input });
}

function unstageSourceControlPaths(input: SourceControlPathsInput) {
  return invoke<void>("source_control_unstage_paths", { input });
}

function discardSourceControlPaths(input: SourceControlPathsInput) {
  return invoke<void>("source_control_discard_paths", { input });
}

function commitSourceControlChanges(input: SourceControlCommitInput) {
  return invoke<void>("source_control_commit", { input });
}

export {
  commitSourceControlChanges,
  discardSourceControlPath,
  discardSourceControlPaths,
  getSourceControlStatus,
  stageSourceControlPath,
  stageSourceControlPaths,
  unstageSourceControlPath,
  unstageSourceControlPaths,
};
