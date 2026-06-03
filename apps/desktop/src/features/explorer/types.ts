type ExplorerTreeInput = {
  folderPath: string;
};

type ExplorerPathMetadata = {
  size: number | null;
  lastModified: number | null;
};

type ExplorerTreeResult = {
  paths: Record<string, ExplorerPathMetadata>;
  truncated: boolean;
  limit: number;
};

export type { ExplorerPathMetadata, ExplorerTreeInput, ExplorerTreeResult };
