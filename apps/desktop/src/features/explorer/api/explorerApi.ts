import { invoke } from "@tauri-apps/api/core";

import type {
  ExplorerDirectoryChildrenInput,
  ExplorerDirectoryChildrenResult,
  ExplorerFileReferenceSuggestionsInput,
  ExplorerFileReferenceSuggestionsResult,
  ExplorerTreeInput,
  ExplorerTreeResult,
} from "../types";

function getExplorerTree(input: ExplorerTreeInput) {
  return invoke<ExplorerTreeResult>("explorer_tree", { input });
}

function getExplorerDirectoryChildren(input: ExplorerDirectoryChildrenInput) {
  return invoke<ExplorerDirectoryChildrenResult>("explorer_directory_children", { input });
}

function getExplorerFileReferenceSuggestions(input: ExplorerFileReferenceSuggestionsInput) {
  return invoke<ExplorerFileReferenceSuggestionsResult>("explorer_file_reference_suggestions", {
    input,
  });
}

export { getExplorerDirectoryChildren, getExplorerFileReferenceSuggestions, getExplorerTree };
