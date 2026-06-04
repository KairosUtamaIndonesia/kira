import { invoke } from "@tauri-apps/api/core";

import type { ExplorerDirectoryChildrenInput, ExplorerDirectoryChildrenResult } from "../types";

function getExplorerDirectoryChildren(input: ExplorerDirectoryChildrenInput) {
  return invoke<ExplorerDirectoryChildrenResult>("explorer_directory_children", { input });
}

export { getExplorerDirectoryChildren };
