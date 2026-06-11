import { invoke } from "@tauri-apps/api/core";

import type {
  ExplorerDirectoryChildrenInput,
  ExplorerDirectoryChildrenResult,
  ExplorerFileReferenceSuggestionsInput,
  ExplorerFileReferenceSuggestionsResult,
} from "../types";

function getExplorerDirectoryChildren(input: ExplorerDirectoryChildrenInput) {
  return invoke<ExplorerDirectoryChildrenResult>("explorer_directory_children", { input });
}

function getExplorerFileReferenceSuggestions(input: ExplorerFileReferenceSuggestionsInput) {
  return invoke<ExplorerFileReferenceSuggestionsResult>("explorer_file_reference_suggestions", {
    input,
  });
}

export { getExplorerDirectoryChildren, getExplorerFileReferenceSuggestions };
