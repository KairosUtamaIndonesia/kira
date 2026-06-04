import { create, type StoreApi } from "zustand";

import type { ExplorerEntry, ExplorerTreeResult } from "../types";

import { getExplorerDirectoryChildren } from "../api/explorerApi";

const rootExplorerDirectoryPath = "";

type ExplorerDirectoryResource =
  | { status: "loading"; requestId: number; previousEntries?: ExplorerEntry[] }
  | { status: "ready"; entries: ExplorerEntry[] }
  | { status: "error"; message: string; previousEntries?: ExplorerEntry[] };

type ExplorerDirectoryError = {
  directoryPath: string;
  message: string;
};

type ExplorerTreeState =
  | { status: "idle" }
  | { status: "loading"; requestId: number; previousResult?: ExplorerTreeResult }
  | {
      status: "ready";
      result: ExplorerTreeResult;
      directories: Record<string, ExplorerDirectoryResource>;
      directoryError?: ExplorerDirectoryError;
    }
  | { status: "error"; message: string; previousResult?: ExplorerTreeResult };

type ExplorerStoreState = {
  resources: Record<string, ExplorerTreeState>;
  load: (folderPath: string) => Promise<void>;
  loadDirectory: (folderPath: string, directoryPath: string) => Promise<void>;
  refresh: (folderPath: string) => Promise<void>;
};

type PreviousExplorerResult = { status: "none" } | { status: "some"; result: ExplorerTreeResult };

type PreviousExplorerDirectoryEntries =
  | { status: "none" }
  | { status: "some"; entries: ExplorerEntry[] };

type ExplorerStoreSet = StoreApi<ExplorerStoreState>["setState"];
type ExplorerStoreGet = StoreApi<ExplorerStoreState>["getState"];

let nextExplorerRequestId = 0;

const idleExplorerTreeState = { status: "idle" } satisfies ExplorerTreeState;

const useExplorerStore = create<ExplorerStoreState>((set, get) => ({
  resources: {},
  async load(folderPath) {
    const currentResource = get().resources[folderPath];
    if (isLoadedOrLoading(currentResource)) {
      return;
    }

    await startRootExplorerRequest({
      folderPath,
      previousResult: previousResultFrom(currentResource),
      set,
      get,
    });
  },
  async loadDirectory(folderPath, directoryPath) {
    if (directoryPath === rootExplorerDirectoryPath) {
      await get().load(folderPath);
      return;
    }

    const projectResource = get().resources[folderPath];
    if (projectResource === undefined || projectResource.status !== "ready") {
      return;
    }

    const directoryResource = projectResource.directories[directoryPath];
    if (isDirectoryLoadedOrLoading(directoryResource)) {
      return;
    }

    await startDirectoryExplorerRequest({
      directoryPath,
      folderPath,
      previousEntries: previousEntriesFrom(directoryResource),
      set,
      get,
    });
  },
  async refresh(folderPath) {
    const currentResource = get().resources[folderPath];
    if (isLoading(currentResource)) {
      return;
    }

    await startRootExplorerRequest({
      folderPath,
      previousResult: previousResultFrom(currentResource),
      set,
      get,
    });
  },
}));

type RootExplorerRequestInput = {
  folderPath: string;
  previousResult: PreviousExplorerResult;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

async function startRootExplorerRequest({
  folderPath,
  previousResult,
  set,
  get,
}: RootExplorerRequestInput) {
  const requestId = nextRequestId();

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: rootLoadingResource(requestId, previousResult),
    },
  }));

  try {
    const result = await getExplorerDirectoryChildren({
      folderPath,
      directoryPath: rootExplorerDirectoryPath,
    });
    setRootExplorerRequestResult({
      entries: result.entries,
      folderPath,
      requestId,
      set,
      get,
    });
  } catch (error) {
    setRootExplorerRequestError({
      folderPath,
      requestId,
      message: errorMessageFromUnknown(error),
      previousResult,
      set,
      get,
    });
  }
}

type RootExplorerRequestResultInput = {
  folderPath: string;
  requestId: number;
  entries: ExplorerEntry[];
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setRootExplorerRequestResult({
  folderPath,
  requestId,
  entries,
  set,
  get,
}: RootExplorerRequestResultInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentRootRequest(currentResource, requestId)) {
    return;
  }

  const directories = {
    [rootExplorerDirectoryPath]: { status: "ready", entries },
  } satisfies Record<string, ExplorerDirectoryResource>;
  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: {
        status: "ready",
        directories,
        result: composeExplorerResult(directories),
      },
    },
  }));
}

type RootExplorerRequestErrorInput = {
  folderPath: string;
  requestId: number;
  message: string;
  previousResult: PreviousExplorerResult;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setRootExplorerRequestError({
  folderPath,
  requestId,
  message,
  previousResult,
  set,
  get,
}: RootExplorerRequestErrorInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentRootRequest(currentResource, requestId)) {
    return;
  }

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: rootErrorResource(message, previousResult),
    },
  }));
}

type DirectoryExplorerRequestInput = {
  folderPath: string;
  directoryPath: string;
  previousEntries: PreviousExplorerDirectoryEntries;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

async function startDirectoryExplorerRequest({
  folderPath,
  directoryPath,
  previousEntries,
  set,
  get,
}: DirectoryExplorerRequestInput) {
  const requestId = nextRequestId();
  setReadyDirectoryResource({
    folderPath,
    directoryPath,
    directoryResource: directoryLoadingResource(requestId, previousEntries),
    clearDirectoryError: true,
    set,
    get,
  });

  try {
    const result = await getExplorerDirectoryChildren({ folderPath, directoryPath });
    setDirectoryExplorerRequestResult({
      folderPath,
      directoryPath,
      requestId,
      entries: result.entries,
      set,
      get,
    });
  } catch (error) {
    setDirectoryExplorerRequestError({
      folderPath,
      directoryPath,
      requestId,
      message: errorMessageFromUnknown(error),
      previousEntries,
      set,
      get,
    });
  }
}

type DirectoryExplorerRequestResultInput = {
  folderPath: string;
  directoryPath: string;
  requestId: number;
  entries: ExplorerEntry[];
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setDirectoryExplorerRequestResult({
  folderPath,
  directoryPath,
  requestId,
  entries,
  set,
  get,
}: DirectoryExplorerRequestResultInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentDirectoryRequest(currentResource, directoryPath, requestId)) {
    return;
  }

  setReadyDirectoryResource({
    folderPath,
    directoryPath,
    directoryResource: { status: "ready", entries },
    clearDirectoryError: true,
    set,
    get,
  });
}

type DirectoryExplorerRequestErrorInput = {
  folderPath: string;
  directoryPath: string;
  requestId: number;
  message: string;
  previousEntries: PreviousExplorerDirectoryEntries;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setDirectoryExplorerRequestError({
  folderPath,
  directoryPath,
  requestId,
  message,
  previousEntries,
  set,
  get,
}: DirectoryExplorerRequestErrorInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentDirectoryRequest(currentResource, directoryPath, requestId)) {
    return;
  }

  setReadyDirectoryResource({
    folderPath,
    directoryPath,
    directoryResource: directoryErrorResource(message, previousEntries),
    directoryError: { directoryPath, message },
    clearDirectoryError: false,
    set,
    get,
  });
}

type SetReadyDirectoryResourceInput = {
  folderPath: string;
  directoryPath: string;
  directoryResource: ExplorerDirectoryResource;
  directoryError?: ExplorerDirectoryError | undefined;
  clearDirectoryError: boolean;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setReadyDirectoryResource({
  folderPath,
  directoryPath,
  directoryResource,
  directoryError,
  clearDirectoryError,
  set,
  get,
}: SetReadyDirectoryResourceInput) {
  const currentResource = get().resources[folderPath];
  if (currentResource === undefined || currentResource.status !== "ready") {
    return;
  }

  const directories = {
    ...currentResource.directories,
    [directoryPath]: directoryResource,
  };
  const nextResource = readyExplorerResource({
    directories,
    directoryError,
    clearDirectoryError,
    previousDirectoryError: currentResource.directoryError,
  });

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: nextResource,
    },
  }));
}

type ReadyExplorerResourceInput = {
  directories: Record<string, ExplorerDirectoryResource>;
  directoryError?: ExplorerDirectoryError | undefined;
  previousDirectoryError?: ExplorerDirectoryError | undefined;
  clearDirectoryError: boolean;
};

function readyExplorerResource({
  directories,
  directoryError,
  previousDirectoryError,
  clearDirectoryError,
}: ReadyExplorerResourceInput): ExplorerTreeState {
  if (directoryError !== undefined) {
    return {
      status: "ready",
      directories,
      directoryError,
      result: composeExplorerResult(directories),
    };
  }

  if (clearDirectoryError || previousDirectoryError === undefined) {
    return {
      status: "ready",
      directories,
      result: composeExplorerResult(directories),
    };
  }

  return {
    status: "ready",
    directories,
    directoryError: previousDirectoryError,
    result: composeExplorerResult(directories),
  };
}

function composeExplorerResult(
  directories: Record<string, ExplorerDirectoryResource>,
): ExplorerTreeResult {
  const rootDirectory = directories[rootExplorerDirectoryPath];
  if (rootDirectory === undefined) {
    throw new Error("Explorer root directory entries are missing.");
  }

  const entries: ExplorerEntry[] = [];
  appendDirectoryEntries({ directoryPath: rootExplorerDirectoryPath, directories, entries });
  return { entries };
}

type AppendDirectoryEntriesInput = {
  directoryPath: string;
  directories: Record<string, ExplorerDirectoryResource>;
  entries: ExplorerEntry[];
};

function appendDirectoryEntries({
  directoryPath,
  directories,
  entries,
}: AppendDirectoryEntriesInput) {
  const childEntries = entriesFromDirectoryResource(directories[directoryPath]);
  for (const entry of childEntries) {
    entries.push(entry);
    if (entry.kind === "directory") {
      appendDirectoryEntries({ directoryPath: entry.path, directories, entries });
    }
  }
}

function entriesFromDirectoryResource(resource: ExplorerDirectoryResource | undefined) {
  if (resource === undefined) {
    return [];
  }

  if (resource.status === "ready") {
    return resource.entries;
  }

  if (resource.status === "loading" || resource.status === "error") {
    if (resource.previousEntries === undefined) {
      return [];
    }

    return resource.previousEntries;
  }

  return exhaustiveExplorerDirectoryResource(resource);
}

function nextRequestId() {
  const requestId = nextExplorerRequestId + 1;
  nextExplorerRequestId = requestId;
  return requestId;
}

function isLoadedOrLoading(resource: ExplorerTreeState | undefined) {
  if (resource === undefined) {
    return false;
  }

  return resource.status === "ready" || resource.status === "loading";
}

function isLoading(resource: ExplorerTreeState | undefined) {
  if (resource === undefined) {
    return false;
  }

  return resource.status === "loading";
}

function isDirectoryLoadedOrLoading(resource: ExplorerDirectoryResource | undefined) {
  if (resource === undefined) {
    return false;
  }

  return resource.status === "ready" || resource.status === "loading";
}

function isCurrentRootRequest(resource: ExplorerTreeState | undefined, requestId: number) {
  if (resource === undefined || resource.status !== "loading") {
    return false;
  }

  return resource.requestId === requestId;
}

function isCurrentDirectoryRequest(
  resource: ExplorerTreeState | undefined,
  directoryPath: string,
  requestId: number,
) {
  if (resource === undefined || resource.status !== "ready") {
    return false;
  }

  const directoryResource = resource.directories[directoryPath];
  if (directoryResource === undefined || directoryResource.status !== "loading") {
    return false;
  }

  return directoryResource.requestId === requestId;
}

function rootLoadingResource(
  requestId: number,
  previousResult: PreviousExplorerResult,
): ExplorerTreeState {
  if (previousResult.status === "none") {
    return { status: "loading", requestId };
  }

  return { status: "loading", requestId, previousResult: previousResult.result };
}

function rootErrorResource(
  message: string,
  previousResult: PreviousExplorerResult,
): ExplorerTreeState {
  if (previousResult.status === "none") {
    return { status: "error", message };
  }

  return { status: "error", message, previousResult: previousResult.result };
}

function directoryLoadingResource(
  requestId: number,
  previousEntries: PreviousExplorerDirectoryEntries,
): ExplorerDirectoryResource {
  if (previousEntries.status === "none") {
    return { status: "loading", requestId };
  }

  return { status: "loading", requestId, previousEntries: previousEntries.entries };
}

function directoryErrorResource(
  message: string,
  previousEntries: PreviousExplorerDirectoryEntries,
): ExplorerDirectoryResource {
  if (previousEntries.status === "none") {
    return { status: "error", message };
  }

  return { status: "error", message, previousEntries: previousEntries.entries };
}

function previousResultFrom(resource: ExplorerTreeState | undefined): PreviousExplorerResult {
  if (resource === undefined || resource.status === "idle") {
    return { status: "none" };
  }

  if (resource.status === "ready") {
    return { status: "some", result: resource.result };
  }

  if (resource.status === "loading" || resource.status === "error") {
    if (resource.previousResult === undefined) {
      return { status: "none" };
    }

    return { status: "some", result: resource.previousResult };
  }

  return exhaustiveExplorerTreeState(resource);
}

function previousEntriesFrom(
  resource: ExplorerDirectoryResource | undefined,
): PreviousExplorerDirectoryEntries {
  if (resource === undefined) {
    return { status: "none" };
  }

  if (resource.status === "ready") {
    return { status: "some", entries: resource.entries };
  }

  if (resource.status === "loading" || resource.status === "error") {
    if (resource.previousEntries === undefined) {
      return { status: "none" };
    }

    return { status: "some", entries: resource.previousEntries };
  }

  return exhaustiveExplorerDirectoryResource(resource);
}

function exhaustiveExplorerTreeState(value: never): never {
  throw new Error(`Unhandled Explorer tree state: ${JSON.stringify(value)}`);
}

function exhaustiveExplorerDirectoryResource(value: never): never {
  throw new Error(`Unhandled Explorer directory resource: ${JSON.stringify(value)}`);
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load Explorer.";
}

export { idleExplorerTreeState, rootExplorerDirectoryPath, useExplorerStore };
export type { ExplorerDirectoryError, ExplorerTreeState };
