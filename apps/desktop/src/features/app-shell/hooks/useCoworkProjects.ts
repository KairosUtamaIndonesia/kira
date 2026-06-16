import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentThreadPanelListing, Project } from "@/features/projects/types";

import { listCoworkAgentThreadPanels, listProjects } from "@/features/projects/api/projectsApi";

// Cowork projects with their threads grouped. Projects are sorted by name;
// threads within each project are most-recent-first.
type CoworkProjectWithThreads = {
  project: Project;
  threads: AgentThreadPanelListing[];
};

type CoworkProjectsState =
  | { status: "loading" }
  | { status: "ready"; projects: CoworkProjectWithThreads[] }
  | { status: "error"; message: string };

function useCoworkProjects() {
  const [state, setState] = useState<CoworkProjectsState>({ status: "loading" });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const [projects, threads] = await Promise.all([
        listProjects(),
        listCoworkAgentThreadPanels(),
      ]);

      if (requestIdRef.current !== requestId) {
        return;
      }

      const coworkProjects = projects
        .filter((project) => project.kind === "cowork" && project.intentional)
        // oxlint-disable-next-line unicorn/no-array-sort — toSorted() unavailable (no ES2023 lib)
        .sort((a, b) => a.name.localeCompare(b.name));

      const threadsByProjectId = new Map<string, AgentThreadPanelListing[]>();
      for (const thread of threads) {
        const existing = threadsByProjectId.get(thread.project.id);
        if (existing !== undefined) {
          existing.push(thread);
        } else {
          threadsByProjectId.set(thread.project.id, [thread]);
        }
      }

      const projectsWithThreads: CoworkProjectWithThreads[] = coworkProjects.map((project) => ({
        project,
        threads: threadsByProjectId.get(project.id) ?? [],
      }));

      setState({ status: "ready", projects: projectsWithThreads });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState({ status: "error", message: errorMessageFromUnknown(error) });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      // Invalidate in-flight requests so an unmounted hook never sets state.
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load projects.";
}

export { useCoworkProjects };
export type { CoworkProjectWithThreads, CoworkProjectsState };
