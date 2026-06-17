type MemoryEntry = {
  id: number;
  content: string;
  created: string;
  lastReferenced: string;
};

type ProjectMemoryInfo = {
  id: string;
  name: string;
};

type MemoryStoreType = "user" | "memory" | "failure" | "project";

type MemoryAction = "add" | "edit" | "delete";

type MemoryUpdateInput = {
  storeType: MemoryStoreType;
  action: MemoryAction;
  content: string;
  oldContent?: string;
  projectId?: string;
};

export type { MemoryAction, MemoryEntry, MemoryStoreType, MemoryUpdateInput, ProjectMemoryInfo };
