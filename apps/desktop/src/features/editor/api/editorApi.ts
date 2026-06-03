import { invoke } from "@tauri-apps/api/core";

import type { EditorFileInput, EditorFileReadResult } from "../types";

function readEditorFile(input: EditorFileInput) {
  return invoke<EditorFileReadResult>("editor_file_read", { input });
}

export { readEditorFile };
