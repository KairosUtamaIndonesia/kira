import { invoke } from "@tauri-apps/api/core";

import type { MemoryEntry, MemoryUpdateInput, ProjectMemoryInfo } from "@/features/memory/types";

function getMemoryEntries(storeType: string, projectId?: string): Promise<MemoryEntry[]> {
  return invoke<MemoryEntry[]>("memory_get_entries", { storeType, projectId });
}

function listMemoryProjects(): Promise<ProjectMemoryInfo[]> {
  return invoke<ProjectMemoryInfo[]>("memory_list_projects");
}

function updateMemoryEntry(input: MemoryUpdateInput): Promise<void> {
  return invoke<void>("memory_update_entry", { input });
}

export { getMemoryEntries, listMemoryProjects, updateMemoryEntry };
