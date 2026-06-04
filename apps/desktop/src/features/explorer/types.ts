type ExplorerDirectoryChildrenInput = {
  folderPath: string;
  directoryPath: string;
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

type ExplorerDirectoryChildrenResult = {
  directoryPath: string;
  entries: ExplorerEntry[];
};

export type {
  ExplorerDirectoryChildrenInput,
  ExplorerDirectoryChildrenResult,
  ExplorerEntry,
  ExplorerEntryKind,
  ExplorerTreeResult,
};
