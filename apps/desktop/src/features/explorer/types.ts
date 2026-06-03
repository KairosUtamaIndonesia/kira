type ExplorerTreeInput = {
  folderPath: string;
};

type ExplorerPathMetadata = {
  size: number | null;
  lastModified: number | null;
};

type ExplorerTreeResult = {
  paths: Record<string, ExplorerPathMetadata>;
};

export type { ExplorerPathMetadata, ExplorerTreeInput, ExplorerTreeResult };
