type ExplorerTreeInput = {
  folderPath: string;
};

type ExplorerEntryKind = "directory" | "file";

type ExplorerEntry = {
  path: string;
  kind: ExplorerEntryKind;
  size: number | null;
  lastModified: number | null;
};

type ExplorerTreeResult = {
  entries: ExplorerEntry[];
};

export type { ExplorerEntry, ExplorerEntryKind, ExplorerTreeInput, ExplorerTreeResult };
