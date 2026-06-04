import { create, type StoreApi } from "zustand";

import type { ExplorerTreeResult } from "../types";

import { getExplorerTree } from "../api/explorerApi";

type ExplorerTreeState =
  | { status: "idle" }
  | { status: "loading"; requestId: number; previousResult?: ExplorerTreeResult }
  | { status: "ready"; result: ExplorerTreeResult }
  | { status: "error"; message: string; previousResult?: ExplorerTreeResult };

type ExplorerStoreState = {
  resources: Record<string, ExplorerTreeState>;
  load: (folderPath: string) => Promise<void>;
  refresh: (folderPath: string) => Promise<void>;
};

type PreviousExplorerResult =
  | { status: "none" }
  | { status: "some"; result: ExplorerTreeResult };

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

    await startExplorerRequest({ folderPath, previousResult: previousResultFrom(currentResource), set, get });
  },
  async refresh(folderPath) {
    const currentResource = get().resources[folderPath];
    if (isLoading(currentResource)) {
      return;
    }

    await startExplorerRequest({ folderPath, previousResult: previousResultFrom(currentResource), set, get });
  },
}));

type ExplorerRequestInput = {
  folderPath: string;
  previousResult: PreviousExplorerResult;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

async function startExplorerRequest({ folderPath, previousResult, set, get }: ExplorerRequestInput) {
  const requestId = nextExplorerRequestId + 1;
  nextExplorerRequestId = requestId;

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: loadingResource(requestId, previousResult),
    },
  }));

  try {
    const result = await getExplorerTree({ folderPath });
    setExplorerRequestResult({ folderPath, requestId, result, set, get });
  } catch (error) {
    setExplorerRequestError({
      folderPath,
      requestId,
      message: errorMessageFromUnknown(error),
      previousResult,
      set,
      get,
    });
  }
}

type ExplorerRequestResultInput = {
  folderPath: string;
  requestId: number;
  result: ExplorerTreeResult;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setExplorerRequestResult({
  folderPath,
  requestId,
  result,
  set,
  get,
}: ExplorerRequestResultInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentRequest(currentResource, requestId)) {
    return;
  }

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: { status: "ready", result },
    },
  }));
}

type ExplorerRequestErrorInput = {
  folderPath: string;
  requestId: number;
  message: string;
  previousResult: PreviousExplorerResult;
  set: ExplorerStoreSet;
  get: ExplorerStoreGet;
};

function setExplorerRequestError({
  folderPath,
  requestId,
  message,
  previousResult,
  set,
  get,
}: ExplorerRequestErrorInput) {
  const currentResource = get().resources[folderPath];
  if (!isCurrentRequest(currentResource, requestId)) {
    return;
  }

  set((state) => ({
    resources: {
      ...state.resources,
      [folderPath]: errorResource(message, previousResult),
    },
  }));
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

function isCurrentRequest(resource: ExplorerTreeState | undefined, requestId: number) {
  if (resource === undefined || resource.status !== "loading") {
    return false;
  }

  return resource.requestId === requestId;
}

function loadingResource(
  requestId: number,
  previousResult: PreviousExplorerResult,
): ExplorerTreeState {
  if (previousResult.status === "none") {
    return { status: "loading", requestId };
  }

  return { status: "loading", requestId, previousResult: previousResult.result };
}

function errorResource(message: string, previousResult: PreviousExplorerResult): ExplorerTreeState {
  if (previousResult.status === "none") {
    return { status: "error", message };
  }

  return { status: "error", message, previousResult: previousResult.result };
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

function exhaustiveExplorerTreeState(value: never): never {
  throw new Error(`Unhandled Explorer tree state: ${JSON.stringify(value)}`);
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

export { idleExplorerTreeState, useExplorerStore };
export type { ExplorerTreeState };
