import type { OpenProject } from "@/features/projects/types";

type ActiveWorkspaceState =
  | { status: "none" }
  | { status: "loading"; projectId: string }
  | ({ status: "active" } & OpenProject)
  | { status: "error"; projectId: string; message: string };

export type { ActiveWorkspaceState };
