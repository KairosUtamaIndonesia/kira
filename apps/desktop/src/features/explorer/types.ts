type ExplorerDirectoryChildrenInput = {
  folderPath: string;
  directoryPath: string;
};

type ExplorerTreeInput = {
  folderPath: string;
};

type ExplorerFileReferenceSuggestionsInput = {
  folderPath: string;
  query: string;
  limit: number;
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

type ExplorerFileReferenceSuggestion = {
  path: string;
  kind: ExplorerEntryKind;
  label: string;
  description: string;
};

type ExplorerFileReferenceSuggestionsResult = {
  suggestions: ExplorerFileReferenceSuggestion[];
};

export type {
  ExplorerDirectoryChildrenInput,
  ExplorerDirectoryChildrenResult,
  ExplorerFileReferenceSuggestion,
  ExplorerFileReferenceSuggestionsInput,
  ExplorerFileReferenceSuggestionsResult,
  ExplorerEntry,
  ExplorerEntryKind,
  ExplorerTreeInput,
  ExplorerTreeResult,
};
