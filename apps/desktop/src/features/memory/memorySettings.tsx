import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { MemoryEntry, MemoryUpdateInput, ProjectMemoryInfo } from "@/features/memory/types";

import { toast } from "@/components/ui/sonner";
import {
  getMemoryEntries,
  listMemoryProjects,
  updateMemoryEntry as updateMemoryEntryApi,
} from "@/features/memory/api/memoryApi";

type MemorySettingsStatus = "loading" | "ready" | "error";

type MemorySettingsContextValue = {
  entries: Record<string, MemoryEntry[]>;
  projectList: ProjectMemoryInfo[];
  status: MemorySettingsStatus;
  errorMessage: string | undefined;
  updateEntry: (input: MemoryUpdateInput) => Promise<void>;
  refresh: () => Promise<void>;
};

type MemorySettingsProviderProps = {
  children: ReactNode;
};

const missingMemorySettingsContext = Symbol("missing MemorySettingsContext");
const MemorySettingsContext = createContext<
  MemorySettingsContextValue | typeof missingMemorySettingsContext
>(missingMemorySettingsContext);

function MemorySettingsProvider({ children }: MemorySettingsProviderProps) {
  const [entries, setEntries] = useState<Record<string, MemoryEntry[]>>({});
  const [projectList, setProjectList] = useState<ProjectMemoryInfo[]>([]);
  const [status, setStatus] = useState<MemorySettingsStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    let ignore = false;

    async function loadAll() {
      try {
        const [userEntries, memoryEntries, failureEntries, projects] = await Promise.all([
          getMemoryEntries("user"),
          getMemoryEntries("memory"),
          getMemoryEntries("failure"),
          listMemoryProjects(),
        ]);

        if (ignore) return;

        setEntries({
          user: userEntries,
          memory: memoryEntries,
          failure: failureEntries,
        });
        setProjectList(projects);
        setStatus("ready");
        setErrorMessage(undefined);
      } catch (error) {
        if (ignore) return;

        const message = errorMessageFromUnknown(error);
        setStatus("error");
        setErrorMessage(message);
        toast.error(`Memory settings failed to load: ${message}`);
      }
    }

    void loadAll();

    return () => {
      ignore = true;
    };
  }, []);

  const value = useMemo<MemorySettingsContextValue>(
    () => ({
      entries,
      projectList,
      status,
      errorMessage,
      updateEntry: async (input) => {
        try {
          await updateMemoryEntryApi(input);
          const [userEntries, memoryEntries, failureEntries, projects] = await Promise.all([
            getMemoryEntries("user"),
            getMemoryEntries("memory"),
            getMemoryEntries("failure"),
            listMemoryProjects(),
          ]);

          setEntries({
            user: userEntries,
            memory: memoryEntries,
            failure: failureEntries,
          });
          setProjectList(projects);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Memory update failed: ${message}`);
        }
      },
      refresh: async () => {
        setStatus("loading");
        try {
          const [userEntries, memoryEntries, failureEntries, projects] = await Promise.all([
            getMemoryEntries("user"),
            getMemoryEntries("memory"),
            getMemoryEntries("failure"),
            listMemoryProjects(),
          ]);

          setEntries({
            user: userEntries,
            memory: memoryEntries,
            failure: failureEntries,
          });
          setProjectList(projects);
          setStatus("ready");
          setErrorMessage(undefined);
        } catch (error) {
          const message = errorMessageFromUnknown(error);
          setStatus("error");
          setErrorMessage(message);
          toast.error(`Memory settings failed to refresh: ${message}`);
        }
      },
    }),
    [entries, projectList, errorMessage, status],
  );

  return <MemorySettingsContext.Provider value={value}>{children}</MemorySettingsContext.Provider>;
}

function useMemorySettings() {
  const context = useContext(MemorySettingsContext);
  if (context === missingMemorySettingsContext) {
    throw new Error("useMemorySettings must be used within a MemorySettingsProvider");
  }

  return context;
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export { MemorySettingsProvider, useMemorySettings };
