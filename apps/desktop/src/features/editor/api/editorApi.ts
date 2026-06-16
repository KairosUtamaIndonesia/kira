import { invoke } from "@tauri-apps/api/core";

import type { EditorFileInput, EditorFileReadResult, EditorFileWriteInput } from "../types";

function readEditorFile(input: EditorFileInput) {
  return invoke<EditorFileReadResult>("editor_file_read", { input });
}

function writeEditorFile(input: EditorFileWriteInput) {
  return invoke<void>("editor_file_write", { input });
}

function deleteEditorFile(input: EditorFileInput) {
  return invoke<void>("editor_file_delete", { input });
}

export { deleteEditorFile, readEditorFile, writeEditorFile };
