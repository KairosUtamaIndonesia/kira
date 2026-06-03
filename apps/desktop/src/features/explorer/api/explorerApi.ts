import { invoke } from "@tauri-apps/api/core";

import type { ExplorerTreeInput, ExplorerTreeResult } from "../types";

function getExplorerTree(input: ExplorerTreeInput) {
  return invoke<ExplorerTreeResult>("explorer_tree", { input });
}

export { getExplorerTree };
